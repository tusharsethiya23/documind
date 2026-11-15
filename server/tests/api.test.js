/**
 * HTTP-level tests for validation and error handling.
 * Every request here is rejected before it reaches MongoDB, so no database is needed.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => server.close());

const postJson = (path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

test('health reports degraded when the database is not connected', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).database, 'disconnected');
});

test('unknown API routes return JSON 404', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found.' });
});

test('ask rejects a missing question', async () => {
  const res = await postJson('/ask', JSON.stringify({ question: '   ' }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Ask a question.');
});

test('ask rejects invalid document ids, topK and providers', async () => {
  let res = await postJson('/ask', JSON.stringify({ question: 'Hi', documentIds: ['not-an-id'] }));
  assert.equal(res.status, 400);
  res = await postJson('/ask', JSON.stringify({ question: 'Hi', topK: 99 }));
  assert.equal(res.status, 400);
  res = await postJson('/ask', JSON.stringify({ question: 'Hi', provider: 'gpt' }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Unknown LLM provider/);
});

test('malformed JSON gets a 400, not a 500', async () => {
  const res = await postJson('/ask', '{"question": ');
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Request body is not valid JSON.');
});

test('document routes reject malformed ids', async () => {
  const res = await fetch(`${base}/documents/123`);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Invalid document id.');
});

test('upload rejects non-PDF files', async () => {
  const form = new FormData();
  form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'notes.txt');
  const res = await fetch(`${base}/documents`, { method: 'POST', body: form });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Only PDF files are supported.');
});

test('upload rejects a fake PDF', async () => {
  const form = new FormData();
  form.append('file', new Blob(['not really a pdf'], { type: 'application/pdf' }), 'fake.pdf');
  const res = await fetch(`${base}/documents`, { method: 'POST', body: form });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'That file is not a valid PDF.');
});

test('upload without a file asks for one', async () => {
  const res = await fetch(`${base}/documents`, { method: 'POST', body: new FormData() });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Attach a PDF/);
});
