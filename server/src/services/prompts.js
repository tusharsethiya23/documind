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

export function formatSources(hits) {
  return hits
    .map((hit, i) => {
      const section = hit.section ? ` section="${escapeAttr(hit.section)}"` : '';
      return `<source id="${i + 1}" document="${escapeAttr(hit.filename)}"${section} pages="${pageLabel(hit)}">\n${hit.text}\n</source>`;
    })
    .join('\n\n');
}

export const buildUserPrompt = (question, hits) =>
  `<sources>\n${formatSources(hits)}\n</sources>\n\nQuestion: ${question}`;
