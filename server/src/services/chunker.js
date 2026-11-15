/**
 * Section-aware chunking.
 *
 * Chunks never cross a section heading. Within a section, paragraphs are packed
 * up to `chunkChars`, and the tail of each chunk (up to `overlapChars`) is
 * carried into the next one. Each chunk keeps the page regions it came from so
 * an answer can cite, and the viewer can highlight, the exact passage.
 */

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/;

/** Cut at the last space before maxChars (or at maxChars if there is no space). */
function hardWrap(text, maxChars) {
  const cut = text.lastIndexOf(' ', maxChars);
  const at = cut > maxChars * 0.5 ? cut : maxChars;
  return [text.slice(0, at).trimEnd(), text.slice(at).trimStart()];
}

/** Split an oversized block on sentence boundaries, hard-wrapping as a last resort. */
export function splitLong(block, maxChars) {
  if (block.text.length <= maxChars) return [{ text: block.text, bbox: block.bbox }];
  const pieces = [];
  let current = '';
  for (let sentence of block.text.split(SENTENCE_SPLIT)) {
    while (sentence.length > maxChars) {
      if (current) {
        pieces.push(current);
        current = '';
      }
      const [head, rest] = hardWrap(sentence, maxChars);
      pieces.push(head);
      sentence = rest;
    }
    if (current && current.length + 1 + sentence.length > maxChars) {
      pieces.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) pieces.push(current);
  return pieces.map((text) => ({ text, bbox: block.bbox }));
}

function dedupeRegions(pieces) {
  const seen = new Set();
  const regions = [];
  for (const { bbox } of pieces) {
    const k = `${bbox.page}:${bbox.x}:${bbox.y}`;
    if (!seen.has(k)) {
      seen.add(k);
      regions.push(bbox);
    }
  }
  return regions;
}

/**
 * @param {{blocks: Array<{text:string,page:number,bbox:object,isHeading:boolean}>}} doc
 * @returns {Array<{index:number, section:string, text:string, pageStart:number, pageEnd:number, regions:object[]}>}
 */
export function chunkDocument(doc, { chunkChars = 1200, overlapChars = 200 } = {}) {
  const chunks = [];
  let section = '';
  let buffer = [];

  const size = () => buffer.reduce((n, p) => n + p.text.length + 1, 0);

  const flush = (keepOverlap) => {
    if (!buffer.length) return;
    const regions = dedupeRegions(buffer);
    const pages = regions.map((r) => r.page);
    chunks.push({
      index: chunks.length,
      section,
      text: buffer.map((p) => p.text).join('\n'),
      pageStart: Math.min(...pages),
      pageEnd: Math.max(...pages),
      regions,
    });
    if (!keepOverlap) {
      buffer = [];
      return;
    }
    const carried = [];
    let carriedSize = 0;
    for (let i = buffer.length - 1; i >= 0; i--) {
      if (carriedSize + buffer[i].text.length > overlapChars) break;
      carried.unshift(buffer[i]);
      carriedSize += buffer[i].text.length;
    }
    // Never carry the whole buffer, or the same text would repeat forever.
    buffer = carried.length < buffer.length ? carried : [];
  };

  for (const block of doc.blocks) {
    if (block.isHeading) {
      flush(false);
      section = block.text;
      continue;
    }
    for (const piece of splitLong(block, chunkChars)) {
      if (buffer.length && size() + piece.text.length > chunkChars) flush(true);
      buffer.push(piece);
    }
  }
  flush(false);
  return chunks;
}

/** Text sent to the embedding model: a short context header plus the passage. */
export function embeddingText(chunk, title) {
  const header = chunk.section ? `Document: ${title}\nSection: ${chunk.section}` : `Document: ${title}`;
  return `${header}\n\n${chunk.text}`;
}
