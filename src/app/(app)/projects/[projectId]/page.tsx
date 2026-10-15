import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BookOpen, Clock, MessageCircle, Users } from "lucide-react";
import { getDb } from "@/db";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { getProjectAccess } from "@/server/authz";
import { requireUser } from "@/server/session";
import { getProjectOverview } from "@/server/overview";
import { countReviewItems } from "@/server/memory/service";
import { Notice } from "@/components/ui/notice";
import { relativeTime } from "@/lib/utils/dates";
import { INTENDED_SCOPES } from "@/lib/validation/project";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function ProjectOverviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireUser();
  const db = await getDb();
  const access = await getProjectAccess(db, user.id, projectId);
  if (!access) notFound();
  const overview = await getProjectOverview(db, projectId);
  const reviewCount = access.permissions.has("memory:write") ? await countReviewItems(db, projectId) : 0;
  const { project } = access;
  const scope = INTENDED_SCOPES.find((s) => s.value === project.intendedScope)?.label ?? project.intendedScope;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8" style={{ paddingBottom: "calc(2rem + var(--safe-bottom))" }}>
      <Card className="bg-white">
        <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[0.8rem] font-medium uppercase tracking-[0.12em] text-ink-3">{scope}</p>
            <h1 className="mt-1 font-serif text-[1.8rem] leading-tight text-ink">
              {overview.answerCount === 0 ? "Ready for the first conversation" : "Continue your story"}
            </h1>
            <p className="mt-1 text-[0.95rem] text-ink-2">
              {overview.answerCount === 0
                ? "The interviewer will start gently and follow where the memories lead."
                : `${overview.answerCount} answer${overview.answerCount === 1 ? "" : "s"} saved${overview.lastActivityAt ? ` · last worked on ${relativeTime(overview.lastActivityAt)}` : ""}`}
            </p>
          </div>
          <ButtonLink href={`/projects/${project.id}/interview`} size="lg" className="shrink-0">
            {overview.openSession ? "Continue the conversation" : "Start a conversation"}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </ButtonLink>
        </CardBody>
      </Card>

      {reviewCount > 0 ? (
        <Notice className="mt-4" tone="warning" title={`${reviewCount} detail${reviewCount === 1 ? "" : "s"} to confirm`}>
          The note-taker wasn&rsquo;t sure about a few things. <Link href={`/projects/${project.id}/review`} className="font-medium text-clay hover:text-clay-2">Take a look</Link> when you have a moment.
        </Notice>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile href={`/projects/${project.id}/interview`} icon={MessageCircle} title="Interview" text={overview.sessionCount === 0 ? "No sessions yet" : `${overview.sessionCount} session${overview.sessionCount === 1 ? "" : "s"}`} />
        <Tile href={`/projects/${project.id}/timeline`} icon={Clock} title="Timeline" text={overview.eventCount === 0 ? "Events appear as you talk" : `${overview.eventCount} event${overview.eventCount === 1 ? "" : "s"} noted`} />
        <Tile href={`/projects/${project.id}/people`} icon={Users} title="People" text={overview.peopleCount === 0 ? "No one mentioned yet" : `${overview.peopleCount} ${overview.peopleCount === 1 ? "person" : "people"}`} />
        <Tile href={`/projects/${project.id}/book`} icon={BookOpen} title="My Book" text={overview.chapterCount === 0 ? "Chapters come from your answers" : `${overview.chapterCount} chapter${overview.chapterCount === 1 ? "" : "s"}`} />
      </div>

      <section className="mt-8 grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <h2 className="font-serif text-[1.3rem] text-ink">How the book is taking shape</h2>
          {overview.chapters.length === 0 ? (
            <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-2">
              After a few answers, LifeStory proposes chapters based on what you have talked about. Each chapter shows which answers it draws on, and you decide when to draft, edit or regenerate it.
            </p>
          ) : (
            <ol className="mt-3 divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-white/80">
              {overview.chapters.map((c) => (
                <li key={c.id}>
                  <Link href={`/projects/${project.id}/book/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-paper-2/60">
                    <span className="min-w-0">
                      <span className="block truncate font-serif text-[1.1rem] text-ink">{c.title}</span>
                      <span className="block text-[0.85rem] text-ink-3">{describeChapterStatus(c.status, c.needsUpdate)}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="lg:col-span-2">
          <h2 className="font-serif text-[1.3rem] text-ink">Open threads</h2>
          {overview.openThreads.length === 0 ? (
            <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-2">
              As stories come up that deserve more time, they are kept here so nothing is forgotten.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {overview.openThreads.map((t) => (
                <li key={t.id} className="rounded-[var(--radius-md)] border border-line bg-white/80 px-4 py-3">
                  <p className="font-medium text-ink">{t.title}</p>
                  {t.suggestedFollowUp ? <p className="mt-0.5 text-[0.875rem] text-ink-2">{t.suggestedFollowUp}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Tile({ href, icon: Icon, title, text }: { href: string; icon: typeof BookOpen; title: string; text: string }) {
  return (
    <Link href={href} className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-line bg-white/80 p-4 transition-colors hover:border-line-2 hover:bg-white">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-clay-soft text-clay">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-ink">{title}</span>
        <span className="block text-[0.85rem] text-ink-3">{text}</span>
      </span>
    </Link>
  );
}

function describeChapterStatus(status: string, needsUpdate: boolean): string {
  if (needsUpdate) return "New answers may belong here";
  switch (status) {
    case "planned": return "Planned, not drafted yet";
    case "drafted": return "Drafted, awaiting your review";
    case "edited": return "Edited by you";
    case "needs_review": return "Has flagged passages";
    default: return status;
  }
}
