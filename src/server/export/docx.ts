import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  TableOfContents,
  TextRun,
} from "docx";
import type { BookModel } from "./manuscript";

/** Editable Word document with real heading styles and a table of contents field. */
export async function renderBookDocx(book: BookModel): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({ text: "", spacing: { before: 4000 } }),
    new Paragraph({ children: [new TextRun({ text: book.title, size: 56, font: "Georgia" })], alignment: AlignmentType.CENTER, heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: `by ${book.narratorName}`, size: 28, font: "Georgia", italics: true })], alignment: AlignmentType.CENTER, spacing: { before: 300 } }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
  if (book.chapters.length > 1) {
    children.push(new Paragraph({ text: "Contents", heading: HeadingLevel.HEADING_1 }));
    children.push(new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-1" }) as unknown as Paragraph);
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }
  book.chapters.forEach((chapter, i) => {
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({ text: chapter.title, heading: HeadingLevel.HEADING_1 }));
    if (chapter.subtitle) children.push(new Paragraph({ children: [new TextRun({ text: chapter.subtitle, italics: true })], spacing: { after: 240 } }));
    for (const p of chapter.paragraphs) {
      children.push(new Paragraph({ children: [new TextRun({ text: p, font: "Georgia", size: 24 })], spacing: { after: 200, line: 340 } }));
    }
  });
  const doc = new Document({
    creator: "LifeStory",
    title: book.title,
    description: `Memoir of ${book.narratorName}`,
    styles: {
      default: { document: { run: { font: "Georgia", size: 24 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 36, font: "Georgia", bold: false }, paragraph: { spacing: { before: 480, after: 240 }, alignment: AlignmentType.CENTER } },
      ],
    },
    features: { updateFields: true },
    sections: [
      {
        properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        footers: {
          default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] }),
        },
        children,
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}
