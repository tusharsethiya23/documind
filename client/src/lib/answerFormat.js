/**
 * Turns an answer string into blocks the UI can render:
 * paragraphs and bullet lists, whose text is split into plain text,
 * **bold** text and [n] citation markers.
 */

const CITATION = /\[(\d+(?:\s*[,;]\s*\d+)*)\]/g

/** "Paris [1][2], founded [3]" -> [{type:'text'}, {type:'cite', n:1}, ...] */
export function splitInline(text) {
  const parts = []
  let last = 0
  for (const match of text.matchAll(CITATION)) {
    if (match.index > last) parts.push(...splitBold(text.slice(last, match.index)))
    for (const n of match[1].split(/[,;]/)) parts.push({ type: 'cite', n: Number(n.trim()) })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(...splitBold(text.slice(last)))
  return parts
}

function splitBold(text) {
  const parts = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push({ type: 'text', text: text.slice(last, m.index) })
    parts.push({ type: 'bold', text: m[1] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) })
  return parts
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/

/** Split into paragraphs and lists. Works on partial text while streaming. */
export function toBlocks(text) {
  const blocks = []
  for (const chunk of text.split(/\n{2,}/)) {
    const lines = chunk.split('\n').filter((l) => l.trim())
    if (!lines.length) continue
    let paragraph = []
    let list = null
    const flushParagraph = () => {
      if (paragraph.length) blocks.push({ type: 'p', parts: splitInline(paragraph.join(' ')) })
      paragraph = []
    }
    for (const line of lines) {
      if (BULLET.test(line)) {
        flushParagraph()
        if (!list) {
          list = { type: 'list', ordered: /^\s*\d/.test(line), items: [] }
          blocks.push(list)
        }
        list.items.push(splitInline(line.replace(BULLET, '')))
      } else {
        list = null
        paragraph.push(line.trim())
      }
    }
    flushParagraph()
  }
  return blocks
}

/** Cited source numbers in order of first appearance. */
export function citedNumbers(text) {
  const seen = []
  for (const match of text.matchAll(CITATION)) {
    for (const n of match[1].split(/[,;]/).map((s) => Number(s.trim()))) {
      if (!seen.includes(n)) seen.push(n)
    }
  }
  return seen
}

export const pageLabel = (s) => (s.pageStart === s.pageEnd ? `p. ${s.pageStart}` : `pp. ${s.pageStart}–${s.pageEnd}`)
