export const REFUSAL = "I don't know based on the provided documents.";

export const SYSTEM_PROMPT = `You answer questions using only the numbered sources provided by the user.

Rules:
- Use only information stated in the sources. Do not use outside knowledge.
- Cite every factual claim with the number of its source in square brackets, e.g. [2] or [1][3], placed at the end of the sentence it supports.
- Only cite a source for something it actually says. Copy numbers, names and figures exactly.
- If the sources do not contain the answer, reply with exactly: ${REFUSAL}
- If the sources answer only part of the question, answer that part with citations and say plainly which part the documents do not cover.
- Be concise. Use short paragraphs or a bulleted list when it helps readability.`;

const escapeAttr = (s) => String(s).replace(/"/g, '&quot;');

export const pageLabel = (hit) =>
  hit.pageStart === hit.pageEnd ? `${hit.pageStart}` : `${hit.pageStart}-${hit.pageEnd}`;

/**
 * Remove the document's own bracketed reference markers ("FAISS [23]", "[3, 12]", "[4–6]").
 * Otherwise the model copies them into its answer, where they look like our [n] citations.
 */
export const stripReferenceMarkers = (text) =>
  text.replace(/\s?\[\d+(?:\s*[,;–-]\s*\d+)*\]/g, '').replace(/ {2,}/g, ' ');

export function formatSources(hits) {
  return hits
    .map((hit, i) => {
      const section = hit.section ? ` section="${escapeAttr(hit.section)}"` : '';
      const text = stripReferenceMarkers(hit.text);
      return `<source id="${i + 1}" document="${escapeAttr(hit.filename)}"${section} pages="${pageLabel(hit)}">\n${text}\n</source>`;
    })
    .join('\n\n');
}

// Repeated after the question: small models follow the instruction they read last.
const CITE_REMINDER = 'Answer using only the sources above. End every sentence with the [n] of the source it comes from.';

export const buildUserPrompt = (question, hits) =>
  `<sources>\n${formatSources(hits)}\n</sources>\n\nQuestion: ${question}\n\n${CITE_REMINDER}`;
