/** Groq provider against a local fake of its OpenAI-compatible streaming API. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { config } from '../src/config.js';
import { getLLM, LLMError } from '../src/services/llm.js';

let server;
let reply; // (req, res) => void, set per test
let lastBody;

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d)).on('end', () => {
      lastBody = JSON.parse(body);
      reply(req, res);
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  Object.assign(config, { groqApiKey: 'test-key', groqBaseUrl: `http://127.0.0.1:${server.address().port}` });
});

after(() => server.close());

const sse = (res, parts) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const p of parts) res.write(p);
  res.end();
};
const delta = (content, finish = null) =>
  `data: ${JSON.stringify({ choices: [{ delta: content ? { content } : {}, finish_reason: finish }] })}\n\n`;

async function collect(llm) {
  let text = '';
  for await (const part of llm.stream({ system: 'sys', user: 'question' })) text += part;
  return text;
}

test('streams text deltas, including events split across network chunks', async () => {
  const whole = delta('The answer ') + delta('is 4000 [1].') + delta(null, 'stop') + 'data: [DONE]\n\n';
  const cut = whole.indexOf('4000');
  reply = (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-key');
    sse(res, [whole.slice(0, cut), whole.slice(cut)]);
  };
  const llm = getLLM('groq');
  assert.equal(llm.name, `groq:${config.groqModel}`);
  assert.equal(await collect(llm), 'The answer is 4000 [1].');
  assert.equal(lastBody.stream, true);
  assert.deepEqual(lastBody.messages.map((m) => m.role), ['system', 'user']);
});

test('reports a truncated answer', async () => {
  reply = (_req, res) => sse(res, [delta('Partial'), delta(null, 'length'), 'data: [DONE]\n\n']);
  assert.match(await collect(getLLM('groq')), /^Partial\n\n\[Answer truncated/);
});

test('turns a 429 into a friendly rate-limit error', async () => {
  reply = (_req, res) => {
    res.writeHead(429, { 'Content-Type': 'application/json', 'retry-after': '12' });
    res.end(JSON.stringify({ error: { message: 'Rate limit reached for model' } }));
  };
  await assert.rejects(collect(getLLM('groq')), (err) => err instanceof LLMError && /limit reached; try again in 12s/.test(err.message));
});

test('turns a 401 into a clear key error', async () => {
  reply = (_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid API Key' } }));
  };
  await assert.rejects(collect(getLLM('groq')), /Groq API key is invalid/);
});

test('requires an API key', () => {
  const key = config.groqApiKey;
  config.groqApiKey = '';
  try {
    assert.throws(() => getLLM('groq'), /GROQ_API_KEY is not set/);
  } finally {
    config.groqApiKey = key;
  }
});
