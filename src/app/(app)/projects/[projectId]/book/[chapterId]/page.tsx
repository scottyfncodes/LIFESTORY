import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { ChapterWorkspace } from "@/components/book/chapter-workspace";
import { getProjectAccess } from "@/server/authz";
import { isAiEnabled } from "@/server/config";
import { NotFoundError } from "@/server/errors";
import { getChapterDetail, listChapters } from "@/server/manuscript/service";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Chapter" };
export const dynamic = "force-dynamic";

export default async function ChapterPage({ params }: { params: Promise<{ projectId: string; chapterId: string }> }) {
  const { projectId, chapterId } = await params;
  const user = await requireUser();
  const db = await getDb();
  const access = await getProjectAccess(db, user.id, projectId);
  if (!access) notFound();
  let detail;
  try {
    detail = await getChapterDetail(db, projectId, chapterId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const chapters = await listChapters(db, projectId);
  const index = chapters.findIndex((c) => c.id === chapterId) + 1;
  const serial = JSON.parse(JSON.stringify(detail));
  return <ChapterWorkspace projectId={projectId} initial={serial} canEdit={access.permissions.has("manuscript:write")} aiEnabled={isAiEnabled()} chapterIndex={index} />;
}
