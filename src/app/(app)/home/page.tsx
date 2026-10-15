import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, Plus } from "lucide-react";
import { getDb } from "@/db";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { requireUser } from "@/server/session";
import { listProjectsForUser } from "@/server/projects";
import { relativeTime } from "@/lib/utils/dates";
import { INTENDED_SCOPES } from "@/lib/validation/project";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  const user = await requireUser("/home");
  const db = await getDb();
  const projects = await listProjectsForUser(db, user.id);
  const firstName = user.name.split(" ")[0] || user.name;
  const mostRecent = projects[0];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12" style={{ paddingBottom: "calc(3rem + var(--safe-bottom))" }}>
      <PageHeader
        eyebrow={`Welcome back, ${firstName}`}
        title={mostRecent ? "Continue your story" : "Let's begin your story"}
        description={
          mostRecent
            ? "Pick up the conversation where you left off, or open another memoir."
            : "Start with a working title and a name. The first conversation takes it from there."
        }
        actions={
          projects.length > 0 ? (
            <ButtonLink href="/projects/new" variant="secondary">
              <Plus className="h-4 w-4" aria-hidden /> New memoir
            </ButtonLink>
          ) : null
        }
      />

      {deleted === "1" ? <Notice className="mt-6" tone="success">The memoir has been deleted. Its recordings are being removed from storage now.</Notice> : null}

      {mostRecent ? (
        <Card className="mt-8 border-clay/20 bg-white">
          <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[0.8rem] font-medium uppercase tracking-[0.12em] text-ink-3">Most recent</p>
              <h2 className="mt-1 truncate font-serif text-[1.6rem] leading-tight text-ink">{mostRecent.title}</h2>
              <p className="mt-1 text-[0.95rem] text-ink-2">
                {mostRecent.narratorName}&rsquo;s story
                {mostRecent.latestSession ? ` · last worked on ${relativeTime(mostRecent.latestSession.lastActivityAt)}` : " · no interview yet"}
              </p>
              <p className="mt-2 text-[0.9rem] text-ink-3">
                {summarizeProgress(mostRecent.answerCount, mostRecent.chapterCount)}
              </p>
            </div>
            <ButtonLink href={`/projects/${mostRecent.id}/interview`} size="lg" className="shrink-0">
              {mostRecent.latestSession?.status === "active" || mostRecent.latestSession?.status === "paused" ? "Continue the conversation" : "Start a conversation"}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
          </CardBody>
        </Card>
      ) : (
        <div className="mt-8">
          <EmptyState
            icon={BookOpen}
            title="No memoir yet"
            description="Create your first project. You only need a title and the narrator's name to begin; everything else can wait."
            action={
              <ButtonLink href="/projects/new" size="lg">
                Create your first memoir <ArrowRight className="h-4 w-4" aria-hidden />
              </ButtonLink>
            }
          />
        </div>
      )}

      {projects.length > 0 ? (
        <section className="mt-10" aria-labelledby="projects-heading">
          <h2 id="projects-heading" className="font-serif text-[1.4rem] text-ink">Your memoirs</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="block h-full rounded-[var(--radius-lg)] border border-line bg-white/80 p-5 shadow-[var(--shadow-soft)] transition-colors hover:border-line-2 hover:bg-white"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-serif text-[1.3rem] leading-snug text-ink">{p.title}</h3>
                    <Badge tone={p.projectType === "hosted" ? "ochre" : "clay"}>
                      {p.projectType === "hosted" ? "Together" : "My life"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[0.9rem] text-ink-2">
                    {p.narratorName} · {INTENDED_SCOPES.find((s) => s.value === p.intendedScope)?.label ?? p.intendedScope}
                  </p>
                  <p className="mt-3 text-[0.85rem] text-ink-3">
                    {summarizeProgress(p.answerCount, p.chapterCount)}
                    {p.latestSession ? ` · ${relativeTime(p.latestSession.lastActivityAt)}` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function summarizeProgress(answers: number, chapters: number): string {
  if (answers === 0) return "Nothing recorded yet.";
  const a = `${answers} answer${answers === 1 ? "" : "s"} saved`;
  if (chapters === 0) return `${a} · no chapters drafted yet`;
  return `${a} · ${chapters} chapter${chapters === 1 ? "" : "s"} in the book`;
}
