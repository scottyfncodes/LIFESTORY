import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Users } from "lucide-react";
import { getDb } from "@/db";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getProjectAccess } from "@/server/authz";
import { countReviewItems, listPeople } from "@/server/memory/service";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "People" };
export const dynamic = "force-dynamic";

export default async function PeoplePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireUser();
  const db = await getDb();
  const access = await getProjectAccess(db, user.id, projectId);
  if (!access) notFound();
  const [persons, reviewCount] = await Promise.all([listPeople(db, projectId), countReviewItems(db, projectId)]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8" style={{ paddingBottom: "calc(2rem + var(--safe-bottom))" }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[1.9rem] leading-tight text-ink">People</h1>
          <p className="mt-1 text-[0.95rem] text-ink-2">Everyone mentioned so far. Two similar names are kept apart until you say they are the same person.</p>
        </div>
        {reviewCount > 0 ? <ButtonLink href={`/projects/${projectId}/review`} variant="secondary">{reviewCount} thing{reviewCount === 1 ? "" : "s"} to confirm</ButtonLink> : null}
      </div>
      {persons.length === 0 ? (
        <div className="mt-6"><EmptyState icon={Users} title="No one mentioned yet" description="Family, friends, teachers and colleagues appear here as they come up in your answers." action={<ButtonLink href={`/projects/${projectId}/interview`}>Continue the conversation</ButtonLink>} /></div>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {persons.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${projectId}/people/${p.id}`} className="flex h-full items-start justify-between gap-3 rounded-[var(--radius-lg)] border border-line bg-white/80 p-4 transition-colors hover:border-line-2 hover:bg-white">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-serif text-[1.25rem] leading-snug text-ink">{p.preferredName}</span>
                    {p.status === "proposed" ? <Badge tone="clay">to confirm</Badge> : null}
                  </span>
                  <span className="block text-[0.875rem] text-ink-2">{p.relationshipToNarrator ?? "relationship not stated"}{p.aliases.length ? ` · also ${p.aliases.join(", ")}` : ""}</span>
                  <span className="mt-1 block text-[0.8rem] text-ink-3">{p.eventCount} linked event{p.eventCount === 1 ? "" : "s"}</span>
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
