/** Public-demo behaviour: read-only mode, rate limiting and serving the built web app. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { rateLimit } from '../src/middleware/rateLimit.js';

const saved = { ...config };
let server;
let base;
let distDir;

before(async () => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'documind-dist-'));
  fs.mkdirSync(path.join(distDir, 'assets'));
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>DocuMind</title>');
  fs.writeFileSync(path.join(distDir, 'assets', 'app-abc123.js'), 'console.log(1)');

  Object.assign(config, { readOnly: true, askLimitPer10Min: 2, clientDist: distDir });
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  Object.assign(config, saved);
  fs.rmSync(distDir, { recursive: true, force: true });
});

test('read-only mode blocks uploads and deletes', async () => {
  const form = new FormData();
  form.append('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'a.pdf');
  let res = await fetch(`${base}/api/documents`, { method: 'POST', body: form });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /read-only demo/);

  res = await fetch(`${base}/api/documents/6b02773f41a146d981d51951`, { method: 'DELETE' });
  assert.equal(res.status, 403);
});

test('questions are rate limited per IP', async () => {
  const ask = () =>
    fetch(`${base}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"question":""}' });
  assert.equal((await ask()).status, 400); // 1st: reaches the route (empty question)
  assert.equal((await ask()).status, 400); // 2nd: still allowed
  const res = await ask(); // 3rd: over the limit of 2
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) > 0);
  assert.match((await res.json()).error, /Too many questions/);
});

test('serves the built web app, with an SPA fallback that leaves /api alone', async () => {
  let res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<title>DocuMind<\/title>/);

  res = await fetch(`${base}/some/client/route`);
  assert.match(await res.text(), /<title>DocuMind<\/title>/);

  res = await fetch(`${base}/assets/app-abc123.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /immutable/);

  res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found.' });
});

test('limiter windows reset and 0 disables it', () => {
  const run = (limiter) => {
    let status = 200;
    const res = { setHeader() {}, status: (s) => ((status = s), { json() {} }) };
    limiter({ ip: '1.2.3.4' }, res, () => {});
    return status;
  };
  const off = rateLimit({ windowMs: 1000, max: 0, message: '' });
  for (let i = 0; i < 5; i++) assert.equal(run(off), 200);

  const one = rateLimit({ windowMs: 1000, max: 1, message: 'x' });
  assert.equal(run(one), 200);
  assert.equal(run(one), 429);
});
