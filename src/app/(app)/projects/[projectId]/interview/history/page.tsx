import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, MessageCircle } from "lucide-react";
import { getDb } from "@/db";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getProjectAccess } from "@/server/authz";
import { listSessions } from "@/server/interviews";
import { requireUser } from "@/server/session";
import { formatDateTime, relativeTime } from "@/lib/utils/dates";

export const metadata: Metadata = { title: "Conversations" };
export const dynamic = "force-dynamic";

export default async function InterviewHistoryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireUser();
  const db = await getDb();
  const access = await getProjectAccess(db, user.id, projectId);
  if (!access) notFound();
  const sessions = await listSessions(db, projectId);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8" style={{ paddingBottom: "calc(2rem + var(--safe-bottom))" }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[1.9rem] leading-tight text-ink">Conversations</h1>
          <p className="mt-1 text-[0.95rem] text-ink-2">Every interview session, with its saved answers.</p>
        </div>
        <ButtonLink href={`/projects/${projectId}/interview`}>Continue</ButtonLink>
      </div>
      {sessions.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={MessageCircle} title="No conversations yet" description="Your first conversation starts with a gentle opening question." action={<ButtonLink href={`/projects/${projectId}/interview`}>Start talking</ButtonLink>} />
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-white/80">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link href={`/projects/${projectId}/interview/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-paper-2/60">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{formatDateTime(s.startedAt)}</span>
                    <Badge tone={s.status === "completed" ? "moss" : s.status === "paused" ? "ochre" : "clay"}>{s.status === "completed" ? "Finished" : s.status === "paused" ? "Paused" : "In progress"}</Badge>
                  </span>
                  <span className="block text-[0.85rem] text-ink-3">{s.answerCount} answer{s.answerCount === 1 ? "" : "s"} · last activity {relativeTime(s.lastActivityAt)}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
