import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { InterviewWorkspace } from "@/components/interview/workspace";
import type { WorkspaceTurn } from "@/components/interview/types";
import { isAiEnabled, isTranscriptionEnabled, limits } from "@/server/config";
import { NotFoundError } from "@/server/errors";
import { getSessionTranscript } from "@/server/interviews";
import { isStorageAvailable } from "@/server/storage";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Interview" };
export const dynamic = "force-dynamic";

export default async function InterviewSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; sessionId: string }>;
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { projectId, sessionId } = await params;
  const { welcome } = await searchParams;
  const user = await requireUser(`/projects/${projectId}/interview/${sessionId}`);
  const db = await getDb();
  let data;
  try {
    data = await getSessionTranscript(db, user.id, projectId, sessionId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { access, session, turns } = data;
  const canWrite = access.permissions.has("interview:write");
  const workspaceTurns: WorkspaceTurn[] = turns.map((t) => ({
    id: t.id,
    sequenceNumber: t.sequenceNumber,
    speaker: t.speakerType,
    inputMode: t.inputMode,
    originalText: t.originalText,
    correctedText: t.correctedText,
    skipped: Boolean(t.metadata.skipped),
    createdAt: t.createdAt.toISOString(),
    processingStatus: t.metadata.processingStatus ?? null,
    media: t.media.map((m) => ({ id: m.id, processingStatus: m.processingStatus, durationSeconds: m.durationSeconds, deleted: Boolean(m.deletedAt) })),
  }));

  return (
    <InterviewWorkspace
      projectId={projectId}
      session={{ id: session.id, status: session.sessionStatus, startedAt: session.startedAt.toISOString() }}
      narratorName={access.project.narratorName}
      mode={access.project.projectType}
      initialTurns={workspaceTurns}
      capabilities={{
        ai: isAiEnabled(),
        transcription: isTranscriptionEnabled(),
        storage: isStorageAvailable(),
        maxRecordingSeconds: limits().maxRecordingSeconds,
      }}
      welcome={welcome === "1"}
      readOnly={!canWrite}
    />
  );
}
