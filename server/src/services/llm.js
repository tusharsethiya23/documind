/**
 * LLM providers behind one interface:
 *   llm.stream({ system, user }) -> async iterator of text chunks
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

  async *stream({ system, user }) {
    let final;
    try {
      // Server-side fallback: if the model declines the request, the API
      // re-runs it on a fallback model inside the same call.
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort: config.claudeEffort },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
      }
      final = await stream.finalMessage();
    } catch (err) {
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

  async *stream({ system, user }) {
    try {
      const response = await this.client.chat({
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
      if (err.name === 'ResponseError') {
        throw new LLMError(`Ollama error: ${err.error ?? err.message}. Did you run \`ollama pull ${this.model}\`?`);
      }
      if (err.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err.message)) {
        throw new LLMError(`Could not reach Ollama at ${config.ollamaHost}. Is it running?`);
      }
      throw err;
    }
  }
}

export function getLLM(provider = config.llmProvider) {
  switch (provider.toLowerCase()) {
    case 'claude':
      return new ClaudeLLM();
    case 'ollama':
      return new OllamaLLM();
    default:
      throw new LLMError(`Unknown LLM provider "${provider}". Use "claude" or "ollama".`);
  }
}
