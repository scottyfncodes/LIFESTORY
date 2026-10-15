import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/db";
import { Badge } from "@/components/ui/badge";
import { PersonForm } from "@/components/memory/person-form";
import { PersonTools } from "@/components/memory/person-tools";
import { describeWhen } from "@/components/memory/when";
import { getProjectAccess } from "@/server/authz";
import { NotFoundError } from "@/server/errors";
import { getPersonDetail, listPeople } from "@/server/memory/service";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Person" };
export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ projectId: string; personId: string }> }) {
  const { projectId, personId } = await params;
  const user = await requireUser();
  const db = await getDb();
  const access = await getProjectAccess(db, user.id, projectId);
  if (!access) notFound();
  let detail;
  try {
    detail = await getPersonDetail(db, projectId, personId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const canEdit = access.permissions.has("memory:write");
  const others = (await listPeople(db, projectId)).filter((p) => p.id !== personId).map((p) => ({ id: p.id, name: p.preferredName }));
  const { person } = detail;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8" style={{ paddingBottom: "calc(2rem + var(--safe-bottom))" }}>
      <Link href={`/projects/${projectId}/people`} className="inline-flex items-center gap-1.5 text-[0.9rem] text-ink-2 hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden /> All people</Link>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="font-serif text-[2rem] leading-tight text-ink">{person.preferredName}</h1>
        {person.status === "proposed" ? <Badge tone="clay">to confirm</Badge> : null}
        {person.userVerified ? <Badge tone="moss">checked by you</Badge> : null}
      </div>
      <p className="mt-1 text-[0.95rem] text-ink-2">{person.relationshipToNarrator ?? "Relationship not stated yet"}{person.aliases.length ? ` · also known as ${person.aliases.join(", ")}` : ""}</p>
      {person.description ? <p className="mt-2 max-w-prose text-[1rem] leading-relaxed text-ink-2">{person.description}</p> : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-5">
        <div className="space-y-8 lg:col-span-3">
          <section>
            <h2 className="font-serif text-[1.3rem] text-ink">Stories they appear in</h2>
            {detail.stories.length === 0 ? <p className="mt-2 text-[0.95rem] text-ink-2">No linked answers yet.</p> : (
              <ul className="mt-3 space-y-3">
                {detail.stories.map((s) => (
                  <li key={s.id} className="rounded-[var(--radius-md)] border border-line bg-white/80 px-4 py-3">
                    <p className="whitespace-pre-wrap text-[0.95rem] leading-relaxed text-ink">{s.text.length > 600 ? `${s.text.slice(0, 600)}…` : s.text}</p>
                    <Link href={`/projects/${projectId}/interview/${s.sessionId}`} className="mt-2 inline-block text-[0.8rem] text-clay hover:text-clay-2">Open the conversation</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2 className="font-serif text-[1.3rem] text-ink">Events</h2>
            {detail.events.length === 0 ? <p className="mt-2 text-[0.95rem] text-ink-2">No events linked yet.</p> : (
              <ul className="mt-3 divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-white/80">
                {detail.events.map((e) => { const w = describeWhen(e); return (
                  <li key={e.id} className="px-4 py-3">
                    <p className="text-[0.8rem] text-ink-3">{w.label}{w.approximate ? " (approximate)" : ""}</p>
                    <p className="font-medium text-ink">{e.title}</p>
                  </li>
                ); })}
              </ul>
            )}
          </section>
          {detail.relationships.length > 0 ? (
            <section>
              <h2 className="font-serif text-[1.3rem] text-ink">Relationships</h2>
              <ul className="mt-3 space-y-1 text-[0.95rem] text-ink-2">
                {detail.relationships.map((r) => (
                  <li key={r.id}>{r.direction === "out" ? `${person.preferredName}: ${r.type} of ` : `${r.type}: `}<Link href={`/projects/${projectId}/people/${r.other.id}`} className="text-clay hover:text-clay-2">{r.other.preferredName}</Link></li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <div className="lg:col-span-2">
          {canEdit ? (
            <>
              <h2 className="font-serif text-[1.3rem] text-ink">Details</h2>
              <p className="mt-1 mb-3 text-[0.85rem] text-ink-3">Corrections here update the timeline and future drafts. Your original answers are never rewritten.</p>
              <PersonForm projectId={projectId} personId={person.id} initial={{ preferredName: person.preferredName, fullName: person.fullName, aliases: person.aliases, relationshipToNarrator: person.relationshipToNarrator, description: person.description, notes: person.notes, birthDate: person.birthDate, deathDate: person.deathDate, datePrecision: person.datePrecision }} />
              <PersonTools projectId={projectId} personId={person.id} status={person.status} others={others} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
