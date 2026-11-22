/**
 * LLM providers behind one interface:
 *   llm.stream({ system, user, signal? }) -> async iterator of text chunks
 * Aborting `signal` (e.g. the browser closed the request) stops generation.
 */
import Anthropic from '@anthropic-ai/sdk';
import { Ollama } from 'ollama';
import { config } from '../config.js';

export class LLMError extends Error {}

class ClaudeLLM {
  constructor(model = config.claudeModel) {
    this.model = model;
    this.name = `claude:${model}`;
    this.client = new Anthropic();
  }

  async *stream({ system, user, signal }) {
    let final;
    try {
      // Server-side fallback: if the model declines the request, the API
      // re-runs it on a fallback model inside the same call.
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: 16000,
          system,
          messages: [{ role: 'user', content: user }],
          output_config: { effort: config.claudeEffort },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal },
      );
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
      }
      final = await stream.finalMessage();
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof Anthropic.AuthenticationError) {
        throw new LLMError('Anthropic API key missing or invalid. Set ANTHROPIC_API_KEY in server/.env.');
      }
      if (err instanceof Anthropic.RateLimitError) throw new LLMError('Rate limited by the Anthropic API; try again shortly.');
      if (err instanceof Anthropic.APIConnectionError) throw new LLMError('Could not reach the Anthropic API (network error).');
      if (err instanceof Anthropic.APIError) throw new LLMError(`Anthropic API error ${err.status}: ${err.message}`);
      throw err;
    }

    if (final.stop_reason === 'refusal') yield '\n\n[The model declined to answer this request.]';
    else if (final.stop_reason === 'max_tokens') yield '\n\n[Answer truncated: hit the output token limit.]';
  }
}

class OllamaLLM {
  constructor(model = config.ollamaModel) {
    this.model = model;
    this.name = `ollama:${model}`;
    this.client = new Ollama({ host: config.ollamaHost });
  }

  async *stream({ system, user, signal }) {
    let response;
    const onAbort = () => response?.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      response = await this.client.chat({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: true,
        options: { temperature: 0 },
      });
      for await (const part of response) yield part.message.content;
    } catch (err) {
      if (signal?.aborted) return;
      if (err.name === 'ResponseError') {
        throw new LLMError(`Ollama error: ${err.error ?? err.message}. Did you run \`ollama pull ${this.model}\`?`);
      }
      if (err.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err.message)) {
        throw new LLMError(`Could not reach Ollama at ${config.ollamaHost}. Is it running?`);
      }
      throw err;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Groq (free tier available) through its OpenAI-compatible chat completions API.
 * Uses plain fetch and parses the Server-Sent Events stream itself.
 */
class GroqLLM {
  constructor(model = config.groqModel) {
    if (!config.groqApiKey) throw new LLMError('GROQ_API_KEY is not set. Get a free key at https://console.groq.com/keys');
    this.model = model;
    this.name = `groq:${model}`;
  }

  async *stream({ system, user, signal }) {
    let res;
    try {
      res = await fetch(`${config.groqBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.groqApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          stream: true,
          temperature: 0,
          max_tokens: 4096, // includes reasoning tokens on reasoning models
          // gpt-oss models reason before answering; the reasoning streams in a
          // separate field (ignored here) and this keeps it short.
          ...(this.model.startsWith('openai/gpt-oss') && { reasoning_effort: config.groqReasoningEffort }),
        }),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) return;
      throw new LLMError(`Could not reach Groq (${err.cause?.code ?? err.message}).`);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = body.error?.message ?? res.statusText;
      if (res.status === 401) throw new LLMError('Groq API key is invalid. Check GROQ_API_KEY.');
      if (res.status === 429) {
        const wait = res.headers.get('retry-after');
        throw new LLMError(`Groq free-tier limit reached${wait ? `; try again in ${wait}s` : ''}. (${detail})`);
      }
      throw new LLMError(`Groq error ${res.status}: ${detail}`);
    }

    let buffer = '';
    let finishReason = null;
    try {
      for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          const event = JSON.parse(data);
          if (event.error) throw new LLMError(`Groq error: ${event.error.message ?? 'stream failed'}`);
          const choice = event.choices?.[0];
          if (choice?.delta?.content) yield choice.delta.content;
          if (choice?.finish_reason) finishReason = choice.finish_reason;
        }
      }
    } catch (err) {
      if (signal?.aborted) return;
      throw err instanceof LLMError ? err : new LLMError(`Groq stream failed: ${err.message}`);
    }
    if (finishReason === 'length') yield '\n\n[Answer truncated: hit the output token limit.]';
  }
}

export function getLLM(provider = config.llmProvider) {
  switch (provider.toLowerCase()) {
    case 'claude':
      return new ClaudeLLM();
    case 'ollama':
      return new OllamaLLM();
    case 'groq':
      return new GroqLLM();
    default:
      throw new LLMError(`Unknown LLM provider "${provider}". Use "claude", "groq" or "ollama".`);
  }
}
