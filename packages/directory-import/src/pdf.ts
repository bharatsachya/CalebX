/**
 * PDF → positioned text runs. The only file here that touches pdfjs.
 *
 * The booklets carry a real text layer, so nothing is OCR'd or inferred: every
 * character written to the sheet was copied out of the file. That is the whole
 * reason this pipeline is deterministic rather than a vision model — a
 * transposed digit in a phone number is not recoverable by review, because
 * nobody can tell by looking that 9422890676 should have been 9422890767.
 *
 * `legacy/build/pdf.mjs` is the Node-targeted build; the default entry expects
 * browser globals.
 */

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "./types.ts";

export interface PdfPage {
  page: number;
  items: TextItem[];
}

/** Every page's text runs, in page order. */
export async function readPdf(path: string): Promise<PdfPage[]> {
  // `useSystemFonts` silences font-substitution warnings on these files and has
  // no bearing on the extracted text.
  const doc = await getDocument({ url: path, useSystemFonts: true }).promise;
  const pages: PdfPage[] = [];

  for (let number = 1; number <= doc.numPages; number++) {
    const content = await (await doc.getPage(number)).getTextContent();
    const items: TextItem[] = [];

    for (const entry of content.items) {
      // pdfjs yields marked-content markers alongside text runs; those have no
      // `str` and must not become empty cells.
      if (!("str" in entry) || typeof entry.str !== "string") continue;
      const text = entry.str.trim();
      if (text === "") continue;

      items.push({
        x: entry.transform[4],
        y: entry.transform[5],
        width: entry.width,
        text,
      });
    }

    pages.push({ page: number, items });
  }

  await doc.destroy();
  return pages;
}
