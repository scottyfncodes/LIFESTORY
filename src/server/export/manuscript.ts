import type { RevisionFlag } from "@/db/schema";
import { splitParagraphs } from "../manuscript/service";

/** Provider-independent description of a book ready to typeset. */
export type BookModel = {
  title: string;
  narratorName: string;
  generatedAt: Date;
  chapters: Array<{ title: string; subtitle: string | null; paragraphs: string[]; flags: RevisionFlag[] }>;
};

export function buildBookModel(input: {
  title: string;
  narratorName: string;
  chapters: Array<{ title: string; subtitle: string | null; body: string; flags: RevisionFlag[] }>;
  generatedAt?: Date;
}): BookModel {
  return {
    title: input.title.trim() || "Untitled memoir",
    narratorName: input.narratorName.trim(),
    generatedAt: input.generatedAt ?? new Date(),
    chapters: input.chapters
      .filter((c) => c.body.trim().length > 0)
      .map((c) => ({ title: c.title.trim() || "Untitled chapter", subtitle: c.subtitle?.trim() || null, paragraphs: splitParagraphs(c.body), flags: c.flags })),
  };
}

export function safeFilename(title: string, extension: string): string {
  const base = title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "memoir";
  return `${base}.${extension}`;
}
