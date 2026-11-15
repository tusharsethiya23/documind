import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkDocument, embeddingText, splitLong } from '../src/services/chunker.js';

const bbox = (page, y = 100) => ({ page, x: 72, y, width: 400, height: 20 });
const para = (text, page, y) => ({ text, page, bbox: bbox(page, y), isHeading: false });
const heading = (text, page) => ({ text, page, bbox: bbox(page, 50), isHeading: true });
const words = (n, w = 'Word') => Array.from({ length: n }, (_, i) => `${w}${i}.`).join(' ');

test('chunks never cross a section heading', () => {
  const doc = {
    blocks: [heading('1 Intro', 1), para('Intro text.', 1, 80), heading('2 Methods', 2), para('Methods text.', 2, 80)],
  };
  const chunks = chunkDocument(doc);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map((c) => c.section), ['1 Intro', '2 Methods']);
  assert.equal(chunks[1].text, 'Methods text.');
});

test('tracks page ranges across pages', () => {
  const doc = { blocks: [heading('A', 1), para('End of page one.', 1, 700), para('Start of page two.', 2, 80)] };
  const [chunk] = chunkDocument(doc);
  assert.equal(chunk.pageStart, 1);
  assert.equal(chunk.pageEnd, 2);
  assert.equal(chunk.regions.length, 2);
});

test('respects the size limit and carries overlap between chunks', () => {
  const blocks = Array.from({ length: 10 }, (_, i) => para(`Paragraph ${i}. ${'x'.repeat(140)}`, 1, 100 + i * 20));
  const chunks = chunkDocument({ blocks }, { chunkChars: 500, overlapChars: 200 });
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.text.length <= 500 + 200, `chunk too long: ${c.text.length}`);
  // The last paragraph of chunk 0 starts chunk 1 (overlap).
  const lastOfFirst = chunks[0].text.split('\n').at(-1);
  assert.ok(chunks[1].text.startsWith(lastOfFirst));
});

test('every paragraph ends up in some chunk', () => {
  const blocks = Array.from({ length: 30 }, (_, i) => para(`Unique${i} ${words(15)}`, 1 + Math.floor(i / 10), i * 20));
  const all = chunkDocument({ blocks }, { chunkChars: 400, overlapChars: 100 }).map((c) => c.text).join('\n');
  for (let i = 0; i < 30; i++) assert.ok(all.includes(`Unique${i} `), `lost paragraph ${i}`);
});

test('splits an oversized paragraph on sentence boundaries', () => {
  const pieces = splitLong(para(words(200), 3, 10), 300);
  assert.ok(pieces.length > 1);
  for (const p of pieces) {
    assert.ok(p.text.length <= 300);
    assert.equal(p.bbox.page, 3);
  }
  assert.equal(pieces.map((p) => p.text).join(' '), words(200));
});

test('hard-wraps a run-on sentence at word boundaries', () => {
  const runOn = Array.from({ length: 150 }, (_, i) => `token${i}`).join(' ');
  const pieces = splitLong(para(runOn, 1, 10), 300);
  assert.ok(pieces.length > 1);
  for (const p of pieces) assert.ok(p.text.length <= 300);
  assert.equal(pieces.map((p) => p.text).join(' '), runOn); // no word was cut in half
});

test('hard-wraps text with no spaces at the limit', () => {
  const pieces = splitLong(para('a'.repeat(1000), 1, 10), 300);
  assert.deepEqual(pieces.map((p) => p.text.length), [300, 300, 300, 100]);
});

test('embedding text includes title and section context', () => {
  const text = embeddingText({ section: '2 Methods', text: 'Body.' }, 'My Paper');
  assert.equal(text, 'Document: My Paper\nSection: 2 Methods\n\nBody.');
});
