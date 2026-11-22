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

export const COMPARE_SYSTEM_PROMPT = `You compare documents using only the numbered sources provided by the user. Sources are grouped by document.

Rules:
- Use only information stated in the sources. Do not use outside knowledge.
- Cite every factual claim with its source number in square brackets, e.g. [2], at the end of the sentence.
- Structure the answer as:
  **<document name>**: what this document says about the question, with citations. One short paragraph per document, in the order given.
  **Comparison**: the key similarities and differences, with citations.
- If a document is marked as not covering the question, write only that it doesn't address it (no citation). Never guess what it would say.
- In the comparison, only state facts that appear in the sources. If a detail is given for one document but not another, say it isn't stated rather than assuming it is the same.
- Copy numbers, names and figures exactly. Be concise.`;

// Repeated after the question: small models follow the instruction they read last.
const CITE_REMINDER =
  'Answer using only the sources above. End every sentence with the number of the source it comes from in square brackets, like [1].';

export const buildUserPrompt = (question, hits) =>
  `<sources>\n${formatSources(hits)}\n</sources>\n\nQuestion: ${question}\n\n${CITE_REMINDER}`;

/**
 * Comparison prompt. `groups` = [{ filename, hits, covered }], and `hits` across
 * all groups are numbered continuously so [n] maps to the flat sources list.
 */
export function buildComparePrompt(question, groups) {
  let n = 0;
  const blocks = groups.map(({ filename, hits, covered }) => {
    if (!covered) {
      return `<document name="${escapeAttr(filename)}" covers_question="no">\nNo passage in this document addresses the question.\n</document>`;
    }
    const sources = hits.map((hit) => {
      n += 1;
      const section = hit.section ? ` section="${escapeAttr(hit.section)}"` : '';
      return `<source id="${n}"${section} pages="${pageLabel(hit)}">\n${stripReferenceMarkers(hit.text)}\n</source>`;
    });
    return `<document name="${escapeAttr(filename)}">\n${sources.join('\n\n')}\n</document>`;
  });
  const names = groups.map((g) => g.filename).join(', ');
  return `<documents>\n${blocks.join('\n\n')}\n</documents>\n\nQuestion: ${question}\n\nCompare how these documents address the question: ${names}. ${CITE_REMINDER}`;
}
