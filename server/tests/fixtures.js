import { PDFDocument, StandardFonts } from 'pdf-lib';

const LOREM =
  'Retrieval augmented generation grounds a language model in external documents. ' +
  'The system first splits each document into passages, embeds them, and stores the vectors. ' +
  'At question time it retrieves the most similar passages and asks the model to answer from them. ';

/** Draw text wrapped to a width; returns the y position after the last line. */
function drawParagraph(page, text, { font, size, x, y, width }) {
  const words = text.split(' ');
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > width) {
      page.drawText(line, { x, y, size, font });
      y -= size * 1.25;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    page.drawText(line, { x, y, size, font });
    y -= size * 1.25;
  }
  return y - size; // paragraph gap
}

/**
 * A 3-page "paper": title, numbered section headings, body text,
 * a running header on every page and a page number in the footer.
 */
export async function makeSamplePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const body = { font, size: 11, x: 72, width: 450 };

  const sections = [
    ['1 Introduction', [LOREM, 'The capital of the fictional country Veloria is Brightwater, founded in 1742. ' + LOREM]],
    ['2 Methods', [LOREM + LOREM, 'We measured a retrieval accuracy of 87.5 percent on the held-out set. ' + LOREM]],
    ['3 Results', [LOREM, LOREM + LOREM]],
  ];

  sections.forEach(([heading, paragraphs], i) => {
    const page = pdf.addPage([612, 792]);
    page.drawText('DocuMind Test Paper', { x: 72, y: 760, size: 9, font });
    page.drawText(String(i + 1), { x: 300, y: 30, size: 9, font });
    let y = 720;
    if (i === 0) {
      page.drawText('A Study of Retrieval for Question Answering', { x: 72, y, size: 20, font: bold });
      y -= 50;
    }
    page.drawText(heading, { x: 72, y, size: 14, font: bold });
    y -= 28;
    for (const p of paragraphs) y = drawParagraph(page, p, { ...body, y });
  });

  return Buffer.from(await pdf.save());
}
