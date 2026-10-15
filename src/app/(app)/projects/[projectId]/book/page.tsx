import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { BookOverview } from "@/components/book/book-overview";
import { getProjectAccess } from "@/server/authz";
import { isAiEnabled } from "@/server/config";
import { listAnswers, listChapters } from "@/server/manuscript/service";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "My Book" };
export const dynamic = "force-dynamic";

export default async function BookPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireUser();
  const db = await getDb();
  const access = await getProjectAccess(db, user.id, projectId);
  if (!access) notFound();
  const [chapters, answers] = await Promise.all([listChapters(db, projectId), listAnswers(db, projectId)]);
  const drafted = chapters.filter((c) => c.words > 0).length;
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8" style={{ paddingBottom: "calc(2rem + var(--safe-bottom))" }}>
      <h1 className="font-serif text-[1.9rem] leading-tight text-ink">{access.project.title}</h1>
      <p className="mt-1 text-[0.95rem] text-ink-2">
        {chapters.length === 0 ? "A book written from your answers, chapter by chapter." : `${chapters.length} chapter${chapters.length === 1 ? "" : "s"} · ${drafted} drafted · ${chapters.reduce((n, c) => n + c.words, 0).toLocaleString()} words so far`}
      </p>
      <div className="mt-6">
        <BookOverview
          projectId={projectId}
          canEdit={access.permissions.has("manuscript:write")}
          aiEnabled={isAiEnabled()}
          answerCount={answers.length}
          draftedCount={drafted}
          chapters={chapters.map((c) => ({ id: c.id, title: c.title, subtitle: c.subtitle, chapterOrder: c.chapterOrder, chapterStatus: c.chapterStatus, needsUpdate: c.needsUpdate, needsUpdateReason: c.needsUpdateReason, words: c.words, flagCount: c.flagCount, revisionNumber: c.revisionNumber, excerpt: c.excerpt, plannedCount: c.plannedSourceTurnIds.length }))}
        />
      </div>
    </div>
  );
}
