import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { parsePdf } from '../src/services/pdfParser.js';
import { makeSamplePdf } from './fixtures.js';

let parsed;
before(async () => {
  parsed = await parsePdf(await makeSamplePdf(), 'sample.pdf');
});

test('reads page count and a stable content hash', async () => {
  assert.equal(parsed.numPages, 3);
  assert.match(parsed.fileHash, /^[0-9a-f]{64}$/);
  const again = await parsePdf(await makeSamplePdf(), 'sample.pdf');
  assert.equal(again.fileHash.length, 64);
});

test('uses the largest text on page 1 as the title', () => {
  assert.equal(parsed.title, 'A Study of Retrieval for Question Answering');
});

test('detects numbered section headings', () => {
  const headings = parsed.blocks.filter((b) => b.isHeading).map((b) => b.text);
  for (const h of ['1 Introduction', '2 Methods', '3 Results']) assert.ok(headings.includes(h), `missing ${h}`);
  assert.ok(!headings.some((h) => h.startsWith('Retrieval augmented')), 'body text marked as heading');
});

test('drops running headers and page numbers', () => {
  assert.ok(!parsed.blocks.some((b) => b.text === 'DocuMind Test Paper'));
  assert.ok(!parsed.blocks.some((b) => /^\d+$/.test(b.text)));
});

test('keeps page numbers and top-left positions on blocks', () => {
  const fact = parsed.blocks.find((b) => b.text.includes('87.5 percent'));
  assert.ok(fact, 'fact block not found');
  assert.equal(fact.page, 2);
  const { x, y, width, height } = fact.bbox;
  assert.ok(Math.abs(x - 72) < 1, `x=${x}`);
  assert.ok(y > 0 && y < 792 && width > 100 && height > 5);
  // A block near the top of the page has a smaller y than one lower down.
  const heading = parsed.blocks.find((b) => b.text === '2 Methods');
  assert.ok(heading.bbox.y < fact.bbox.y);
});
