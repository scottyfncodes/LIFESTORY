import { describe, expect, it } from "vitest";
import { buildBookModel, safeFilename } from "@/server/export/manuscript";
import { renderBookPdf } from "@/server/export/pdf";
import { renderBookDocx } from "@/server/export/docx";

const longBody = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}. ${"The porch on Elm Street caught the last of the evening light, and my grandmother would sit there with her tea. ".repeat(4)}`).join("\n\n");

const book = buildBookModel({
  title: "A Long Way From Elm Street — Ünïcödé “quotes” & ampersands <tags>",
  narratorName: "Grace Ó'Malley-Żółć",
  chapters: [
    { title: "An unusually long chapter title that keeps going well beyond what a normal heading would need in order to test wrapping behaviour", subtitle: "1954–1961", body: longBody, flags: [] },
    { title: "Empty chapter is skipped", subtitle: null, body: "   ", flags: [] },
    { title: "Short", subtitle: null, body: "One line.\n\nTwo lines with émojis 🙂 and 日本語.", flags: [{ kind: "uncertain", passage: "One line.", note: "unsure" }] },
  ],
  generatedAt: new Date("2026-10-15T00:00:00Z"),
});

describe("book model", () => {
  it("drops empty chapters and splits paragraphs", () => {
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0].paragraphs).toHaveLength(60);
    expect(book.chapters[1].paragraphs).toEqual(["One line.", "Two lines with émojis 🙂 and 日本語."]);
  });
  it("makes safe filenames", () => {
    expect(safeFilename(book.title, "pdf")).toMatch(/^A-Long-Way-From-Elm-Street.*\.pdf$/);
    expect(safeFilename("///", "docx")).toBe("memoir.docx");
  });
});

describe("pdf export", () => {
  it("produces a multi-page PDF with the title and chapter headings", async () => {
    const bytes = await renderBookPdf(book);
    const head = Buffer.from(bytes.subarray(0, 8)).toString("latin1");
    expect(head.startsWith("%PDF-")).toBe(true);
    const text = Buffer.from(bytes).toString("latin1");
    const pages = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThan(5);
    expect(text).toContain("/Title");
  }, 60_000);
});

describe("docx export", () => {
  it("produces a valid zip containing a document with heading styles", async () => {
    const bytes = await renderBookDocx(book);
    expect(Buffer.from(bytes.subarray(0, 2)).toString("latin1")).toBe("PK");
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain("Short");
    expect(xml).toContain("日本語");
    expect(xml).toContain("TOC");
  }, 60_000);
});
