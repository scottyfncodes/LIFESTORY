import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import { getDb } from "@/db";
import { EventCard, type TimelineEvent } from "@/components/memory/event-card";
import { ThreadList } from "@/components/memory/thread-list";
import { periodKey } from "@/components/memory/when";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { getProjectAccess } from "@/server/authz";
import { isAiEnabled } from "@/server/config";
import { countReviewItems, listEvents, listThreads } from "@/server/memory/service";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Timeline" };
export const dynamic = "force-dynamic";

export default async function TimelinePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireUser();
  const db = await getDb();
  const access = await getProjectAccess(db, user.id, projectId);
  if (!access) notFound();
  const canEdit = access.permissions.has("memory:write");
  const [events, threads, reviewCount] = await Promise.all([listEvents(db, projectId), listThreads(db, projectId), countReviewItems(db, projectId)]);
  const orderedIds = events.map((e) => e.id);
  const groups = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const key = periodKey(e);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e as TimelineEvent);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8" style={{ paddingBottom: "calc(2rem + var(--safe-bottom))" }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[1.9rem] leading-tight text-ink">Life timeline</h1>
          <p className="mt-1 text-[0.95rem] text-ink-2">Events noted from the conversation, in order. Approximate dates are marked; nothing here is guessed.</p>
        </div>
        {reviewCount > 0 ? <ButtonLink href={`/projects/${projectId}/review`} variant="secondary">{reviewCount} thing{reviewCount === 1 ? "" : "s"} to confirm</ButtonLink> : null}
      </div>
      {!isAiEnabled() ? <Notice className="mt-4" tone="info">Automatic note-taking needs an AI provider, which isn&rsquo;t configured on this server. Your answers are still saved in full.</Notice> : null}
      <div className="mt-6 grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {events.length === 0 ? (
            <EmptyState icon={Clock} title="No events yet" description="As you talk, moves, jobs, milestones and turning points are gathered here with the dates you give them." action={<ButtonLink href={`/projects/${projectId}/interview`}>Continue the conversation</ButtonLink>} />
          ) : (
            <div className="space-y-8">
              {[...groups.entries()].map(([period, items]) => (
                <section key={period} aria-labelledby={`period-${period}`}>
                  <h2 id={`period-${period}`} className="mb-3 font-serif text-[1.3rem] text-ink">{period}</h2>
                  <ul className="space-y-3">
                    {items.map((e) => (
                      <EventCard key={e.id} projectId={projectId} event={e} orderedIds={orderedIds} index={orderedIds.indexOf(e.id)} others={events.map((o) => ({ id: o.id, title: o.title }))} canEdit={canEdit} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
        <aside>
          <h2 className="font-serif text-[1.3rem] text-ink">Story threads</h2>
          <p className="mt-1 mb-3 text-[0.875rem] text-ink-3">Things mentioned that the interviewer may return to.</p>
          <ThreadList projectId={projectId} threads={threads.map((t) => ({ id: t.id, title: t.title, summary: t.summary, status: t.status, suggestedFollowUp: t.suggestedFollowUp, importance: t.importance }))} canEdit={canEdit} />
          <p className="mt-6 text-[0.85rem] text-ink-3"><Link href={`/projects/${projectId}/people`} className="text-clay hover:text-clay-2">People in this story</Link></p>
        </aside>
      </div>
    </div>
  );
}
