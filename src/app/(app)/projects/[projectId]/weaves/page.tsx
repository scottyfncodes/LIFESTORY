import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, AudioLines, Plus } from "lucide-react";
import { getDb } from "@/db";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getProjectAccess } from "@/server/authz";
import { isWeaveEnabled } from "@/server/config";
import { requireUser } from "@/server/session";
import { listWeaves } from "@/server/weave/service";
import { relativeTime } from "@/lib/utils/dates";

export const metadata: Metadata = { title: "Conversations" };
export const dynamic = "force-dynamic";

export default async function WeavesPage({ params }: { params: Promise<{ projectId: string }> }) {
  if (!isWeaveEnabled()) notFound();
  const { projectId } = await params;
  const user = await requireUser();
  const db = await getDb();
  const access = await getProjectAccess(db, user.id, projectId);
  if (!access) notFound();
  const weaves = await listWeaves(db, user.id, projectId);
  const canWrite = access.permissions.has("interview:write");

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8" style={{ paddingBottom: "calc(2rem + var(--safe-bottom))" }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[1.9rem] leading-tight text-ink">Conversations</h1>
          <p className="mt-1 max-w-xl text-[0.95rem] text-ink-2">Recorded conversations with family and friends. Upload the recordings of one conversation together and keep the originals safe.</p>
        </div>
        {canWrite && weaves.length > 0 ? (
          <ButtonLink href={`/projects/${projectId}/weaves/new`}>
            <Plus className="h-4 w-4" aria-hidden /> New conversation
          </ButtonLink>
        ) : null}
      </div>
      {weaves.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={AudioLines}
            title="No conversations yet"
            description="Have a recording of you and someone else talking about the past? Add it here, with everyone's agreement, and it is kept privately with this memoir."
            action={canWrite ? <ButtonLink href={`/projects/${projectId}/weaves/new`}>Add a conversation</ButtonLink> : undefined}
          />
        </div>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {weaves.map((w) => (
            <li key={w.id}>
              <Link href={`/projects/${projectId}/weaves/${w.id}`} className="flex h-full items-start justify-between gap-3 rounded-[var(--radius-lg)] border border-line bg-white/80 p-4 transition-colors hover:border-line-2 hover:bg-white">
                <span className="min-w-0">
                  <span className="block font-serif text-[1.25rem] leading-snug text-ink">{w.title}</span>
                  <span className="block text-[0.875rem] text-ink-2">{w.participants.join(", ")}</span>
                  <span className="mt-2 flex flex-wrap items-center gap-2 text-[0.8rem] text-ink-3">
                    <Badge tone={w.recordingCount > 0 ? "moss" : "neutral"}>{w.recordingCount} recording{w.recordingCount === 1 ? "" : "s"}</Badge>
                    added {relativeTime(w.createdAt)}
                  </span>
                </span>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
