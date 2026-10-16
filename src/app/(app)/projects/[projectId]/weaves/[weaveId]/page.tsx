import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { DeleteWeave } from "@/components/weave/delete-weave";
import { RecordingsWorkspace } from "@/components/weave/recordings-workspace";
import type { RecordingDto } from "@/components/weave/upload-recording";
import { getProjectAccess } from "@/server/authz";
import { isWeaveEnabled, weaveLimits } from "@/server/config";
import { NotFoundError } from "@/server/errors";
import { requireUser } from "@/server/session";
import { getWeaveDetail } from "@/server/weave/service";

export const metadata: Metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

export default async function WeavePage({ params }: { params: Promise<{ projectId: string; weaveId: string }> }) {
  if (!isWeaveEnabled()) notFound();
  const { projectId, weaveId } = await params;
  const user = await requireUser();
  const db = await getDb();
  const access = await getProjectAccess(db, user.id, projectId);
  if (!access) notFound();
  let detail: Awaited<ReturnType<typeof getWeaveDetail>>;
  try {
    detail = await getWeaveDetail(db, user.id, projectId, weaveId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const canWrite = access.permissions.has("interview:write");
  const { maxUploadBytes, maxRecordingsPerWeave } = weaveLimits();
  // Dates cross the server/client boundary as strings.
  const recordings = JSON.parse(JSON.stringify(detail.recordings)) as RecordingDto[];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8" style={{ paddingBottom: "calc(2rem + var(--safe-bottom))" }}>
      <Link href={`/projects/${projectId}/weaves`} className="inline-flex items-center gap-1 text-[0.875rem] text-ink-3 hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Conversations
      </Link>
      <h1 className="mt-2 break-words font-serif text-[1.9rem] leading-tight text-ink">{detail.weave.title}</h1>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label="People in this conversation">
        {detail.participants.map((p) => (
          <li key={p.id}><Badge tone={p.isAccountHolder ? "clay" : "neutral"}>{p.displayName}{p.isAccountHolder ? " (you)" : ""}</Badge></li>
        ))}
      </ul>
      {detail.weave.contextNote ? <p className="mt-3 whitespace-pre-wrap text-[0.95rem] leading-relaxed text-ink-2">{detail.weave.contextNote}</p> : null}

      <Notice className="mt-5" tone="info" title="Recordings are kept as they are">
        Your original files are stored privately and are never changed or automatically deleted. Turning them into a written conversation comes in a later update; for now you can upload, listen and add dates and notes.
      </Notice>

      <div className="mt-6">
        <RecordingsWorkspace projectId={projectId} weaveId={weaveId} initialRecordings={recordings} canWrite={canWrite} maxUploadBytes={maxUploadBytes} maxRecordings={maxRecordingsPerWeave} />
      </div>

      {canWrite ? (
        <div className="mt-10">
          <DeleteWeave projectId={projectId} weaveId={weaveId} title={detail.weave.title} />
        </div>
      ) : null}
    </div>
  );
}
