import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/server/session";
import { startNewSession, startOrResumeSession } from "@/server/interviews";
import { NotFoundError } from "@/server/errors";
import { notFound } from "next/navigation";
import { ensureJobHandlers } from "@/server/jobs/handlers";

export const dynamic = "force-dynamic";

/** Entry point: resumes the open conversation or opens a new one. */
export default async function InterviewEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ welcome?: string; new?: string }>;
}) {
  const { projectId } = await params;
  const { welcome, new: startNew } = await searchParams;
  const user = await requireUser(`/projects/${projectId}/interview`);
  const db = await getDb();
  ensureJobHandlers();
  let sessionId: string;
  try {
    if (startNew === "1") {
      sessionId = (await startNewSession(db, user.id, projectId)).id;
    } else {
      sessionId = (await startOrResumeSession(db, user.id, projectId)).session.id;
    }
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  redirect(`/projects/${projectId}/interview/${sessionId}${welcome ? "?welcome=1" : ""}`);
}
