/**
 * PDF -> text blocks with page numbers and positions (pdfjs-dist).
 *
 * pdfjs returns positioned text fragments. We rebuild lines from them, group
 * lines into blocks (paragraphs/headings), drop running headers/footers and
 * page numbers, and flag blocks that look like section headings.
 */
import crypto from 'node:crypto';
import { getDocument, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';

const NUMBERED_HEADING = /^(\d+(\.\d+)*|[IVX]+)\.?\s+[A-Z]/;
const KNOWN_HEADINGS = new Set([
  'abstract', 'introduction', 'background', 'related work', 'method', 'methods',
  'methodology', 'experiments', 'results', 'discussion', 'conclusion', 'conclusions',
  'references', 'acknowledgements', 'acknowledgments', 'appendix',
]);

export const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const round = (n) => Math.round(n * 10) / 10;

function mostCommon(values) {
  const counts = new Map();
  for (const [value, weight] of values) counts.set(value, (counts.get(value) ?? 0) + weight);
  let best;
  let bestCount = -1;
  for (const [value, count] of counts) if (count > bestCount) [best, bestCount] = [value, count];
  return best;
}

/** Text fragments -> lines, in viewport coordinates (top-left origin). */
function buildLines(items, viewport) {
  const lines = [];
  let line = null;
  for (const item of items) {
    if (!('str' in item)) continue; // marked-content markers
    const tx = Util.transform(viewport.transform, item.transform);
    const size = Math.hypot(tx[2], tx[3]);
    const x = tx[4];
    const baseline = tx[5];
    const width = item.width * viewport.scale;

    if (!item.str.trim()) {
      if (line && item.hasEOL) line.ended = true;
      continue;
    }

    const sameLine = line && !line.ended && Math.abs(baseline - line.baseline) < Math.max(size, line.size) * 0.5;
    if (!sameLine) {
      line = { text: '', x0: x, x1: x + width, baseline, size, sizes: [], ended: false };
      lines.push(line);
    } else {
      const gap = x - line.x1;
      const needsSpace = gap > size * 0.15 && !line.text.endsWith(' ') && !item.str.startsWith(' ');
      if (needsSpace) line.text += ' ';
    }
    line.text += item.str;
    line.x0 = Math.min(line.x0, x);
    line.x1 = Math.max(line.x1, x + width);
    line.size = Math.max(line.size, size);
    line.sizes.push([round(size), item.str.length]);
    if (item.hasEOL) line.ended = true;
  }
  return lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim(), size: mostCommon(l.sizes) }));
}

/** Lines -> blocks: break on vertical gaps, font-size changes, or a jump to a new column. */
function buildBlocks(lines, page) {
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (!line.text) continue;
    const top = line.baseline - line.size;
    if (current) {
      const gap = top - current.lastBaseline;
      const sizeChange = Math.abs(line.size - current.fontSize) / current.fontSize > 0.1;
      const newColumn = line.baseline < current.lastBaseline - 1;
      if (gap > current.fontSize * 0.6 || sizeChange || newColumn) current = null;
    }
    if (!current) {
      current = { lines: [], page, fontSize: line.size, x0: line.x0, y0: top, x1: line.x1, lastBaseline: line.baseline };
      blocks.push(current);
    }
    current.lines.push(line.text);
    current.x0 = Math.min(current.x0, line.x0);
    current.x1 = Math.max(current.x1, line.x1);
    current.y0 = Math.min(current.y0, top);
    current.lastBaseline = line.baseline;
  }

  return blocks.map((b) => {
    let text = '';
    for (const l of b.lines) {
      if (/\w-$/.test(text) && /^[a-z]/.test(l)) text = text.slice(0, -1) + l; // re-join hyphenation
      else text = text ? `${text} ${l}` : l;
    }
    return {
      text: text.trim(),
      page: b.page,
      fontSize: b.fontSize,
      bbox: {
        page: b.page,
        x: round(b.x0),
        y: round(b.y0),
        width: round(b.x1 - b.x0),
        height: round(b.lastBaseline - b.y0 + b.fontSize * 0.25),
      },
      isHeading: false,
    };
  });
}

export function stripHeadersFooters(blocks, numPages) {
  const isPageNumber = (t) => /^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(t);
  if (numPages < 3) return blocks.filter((b) => !isPageNumber(b.text));

  const key = (b) => b.text.toLowerCase().replace(/\d+/g, '#');
  const pagesPerKey = new Map();
  for (const b of blocks) {
    if (b.text.length >= 120) continue;
    if (!pagesPerKey.has(key(b))) pagesPerKey.set(key(b), new Set());
    pagesPerKey.get(key(b)).add(b.page);
  }
  const minPages = Math.max(3, numPages * 0.5);
  const repeated = new Set([...pagesPerKey].filter(([, pages]) => pages.size >= minPages).map(([k]) => k));
  return blocks.filter((b) => !isPageNumber(b.text) && !repeated.has(key(b)));
}

export function markHeadings(blocks) {
  if (!blocks.length) return blocks;
  const bodySize = mostCommon(blocks.map((b) => [round(b.fontSize), b.text.length]));

  for (const b of blocks) {
    const words = b.text.split(/\s+/).length;
    if (b.text.length > 120 || words > 14) continue;
    const numbered = NUMBERED_HEADING.test(b.text);
    if (/[.,;]$/.test(b.text) && !numbered) continue; // reads like a sentence

    const bigger = b.fontSize >= bodySize * 1.15;
    const named = KNOWN_HEADINGS.has(b.text.toLowerCase().replace(/^[\d.\sIVX]+/, '').replace(/[:.]$/, '').trim());
    const numberedShort = numbered && words <= 8 && b.fontSize >= bodySize * 0.95 && !/[.]$/.test(b.text);
    b.isHeading = bigger || named || numberedShort;
  }
  return blocks;
}

/**
 * @param {Buffer|Uint8Array} buffer PDF bytes
 * @param {string} filename
 */
export async function parsePdf(buffer, filename) {
  const data = new Uint8Array(buffer);
  const fileHash = sha256(data);
  const loadingTask = getDocument({ data, useSystemFonts: true, isEvalSupported: false, verbosity: 0 });
  const pdf = await loadingTask.promise;

  try {
    let blocks = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      blocks.push(...buildBlocks(buildLines(content.items, viewport), p));
      page.cleanup();
    }
    blocks = markHeadings(stripHeadersFooters(blocks, pdf.numPages));

    const meta = await pdf.getMetadata().catch(() => null);
    let title = (meta?.info?.Title ?? '').trim();
    if (!title) {
      const firstPage = blocks.filter((b) => b.page === 1);
      title = firstPage.length
        ? firstPage.reduce((a, b) => (b.fontSize > a.fontSize ? b : a)).text.slice(0, 200)
        : filename.replace(/\.pdf$/i, '');
    }

    return { fileHash, filename, title, numPages: pdf.numPages, blocks };
  } finally {
    await loadingTask.destroy();
  }
}
