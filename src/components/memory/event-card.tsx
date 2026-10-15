"use client";

import { useActionState, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { EVENT_CATEGORIES } from "@/lib/validation/memory";
import { mergeEventsAction, moveEventAction, setEventStatusAction, updateEventAction, type MemoryActionState } from "@/app/(app)/projects/[projectId]/memory-actions";
import { describeWhen } from "./when";

export type TimelineEvent = {
  id: string;
  title: string;
  description: string;
  category: string;
  startDate: string | null;
  endDate: string | null;
  approximateYear: number | null;
  approximateAge: number | null;
  datePrecision: "exact" | "month" | "year" | "decade" | "approximate" | "unknown";
  location: string | null;
  status: string;
  confidence: string;
  userNote: string | null;
  userVerified: boolean;
  sourceTurnId: string | null;
  people: Array<{ id: string; name: string }>;
};

export function EventCard({ projectId, event, orderedIds, index, others, canEdit }: { projectId: string; event: TimelineEvent; orderedIds: string[]; index: number; others: Array<{ id: string; title: string }>; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const when = describeWhen(event);

  function move(delta: number) {
    const ids = [...orderedIds];
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    startTransition(async () => {
      const r = await moveEventAction(projectId, ids);
      if (r.error) setMessage(r.error);
    });
  }

  return (
    <li className="rounded-[var(--radius-lg)] border border-line bg-white p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.85rem] font-medium text-ink-2">{when.label}</span>
            {when.approximate ? <Badge tone="ochre">approximate</Badge> : null}
            {event.status === "proposed" ? <Badge tone="clay">needs confirming</Badge> : null}
            {event.userVerified ? <Badge tone="moss">checked by you</Badge> : null}
          </div>
          <h3 className="mt-1 font-serif text-[1.25rem] leading-snug text-ink">{event.title}</h3>
          {event.location ? <p className="text-[0.875rem] text-ink-3">{event.location}</p> : null}
        </div>
        {canEdit ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <button type="button" onClick={() => move(-1)} disabled={pending || index === 0} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink disabled:opacity-30" aria-label="Move earlier"><ArrowUp className="h-4 w-4" aria-hidden /></button>
            <button type="button" onClick={() => move(1)} disabled={pending || index === orderedIds.length - 1} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink disabled:opacity-30" aria-label="Move later"><ArrowDown className="h-4 w-4" aria-hidden /></button>
            <button type="button" onClick={() => setEditing((e) => !e)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label="Edit event"><Pencil className="h-4 w-4" aria-hidden /></button>
          </div>
        ) : null}
      </div>
      {!editing ? (
        <>
          {event.description ? <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-2">{event.description}</p> : null}
          {event.userNote ? <p className="mt-2 rounded-md bg-paper-2 px-3 py-2 text-[0.875rem] text-ink-2"><span className="font-medium text-ink">Your note:</span> {event.userNote}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.8rem] text-ink-3">
            {event.people.map((p) => (
              <Link key={p.id} href={`/projects/${projectId}/people/${p.id}`} className="rounded-full border border-line bg-paper px-2.5 py-0.5 text-ink-2 hover:bg-paper-2">{p.name}</Link>
            ))}
            {event.sourceTurnId ? <span>From your answers</span> : null}
          </div>
          {canEdit && event.status === "proposed" ? (
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => startTransition(async () => { const r = await setEventStatusAction(projectId, event.id, "confirmed"); if (r.error) setMessage(r.error); })} loading={pending}>Yes, keep it</Button>
              <Button size="sm" variant="ghost" onClick={() => startTransition(async () => { const r = await setEventStatusAction(projectId, event.id, "rejected"); if (r.error) setMessage(r.error); })}>No, remove</Button>
            </div>
          ) : null}
        </>
      ) : (
        <EventForm projectId={projectId} event={event} onDone={() => setEditing(false)} />
      )}
      {canEdit && editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {!merging ? (
            <button type="button" onClick={() => setMerging(true)} className="text-[0.85rem] text-ink-3 hover:text-ink">Merge another event into this one</button>
          ) : (
            <form action={async (fd) => { const r = await mergeEventsAction(projectId, event.id, fd); if (r.error) setMessage(r.error); else setMerging(false); }} className="flex flex-wrap items-center gap-2">
              <Select name="duplicateId" className="h-9 w-64 text-[0.875rem]" defaultValue="" aria-label="Event to merge">
                <option value="" disabled>Choose an event…</option>
                {others.filter((o) => o.id !== event.id).map((o) => (<option key={o.id} value={o.id}>{o.title}</option>))}
              </Select>
              <Button size="sm" type="submit" variant="secondary">Merge</Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => setMerging(false)}>Cancel</Button>
            </form>
          )}
          <button type="button" onClick={() => { if (window.confirm("Remove this event from the timeline? Your answers are not changed.")) startTransition(async () => { const r = await setEventStatusAction(projectId, event.id, "rejected"); if (r.error) setMessage(r.error); }); }} className="ml-auto inline-flex items-center gap-1 text-[0.85rem] text-ink-3 hover:text-rose"><Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove</button>
        </div>
      ) : null}
      {message ? <p className="mt-2 text-[0.85rem] text-rose" role="alert">{message}</p> : null}
    </li>
  );
}

function EventForm({ projectId, event, onDone }: { projectId: string; event: TimelineEvent; onDone: () => void }) {
  const action = updateEventAction.bind(null, projectId, event.id);
  const [state, formAction, pending] = useActionState<MemoryActionState, FormData>(async (prev, fd) => {
    const r = await action(prev, fd);
    if (r.success) onDone();
    return r;
  }, {});
  return (
    <form action={formAction} className="mt-3 grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2"><Field label="Title" htmlFor={`title-${event.id}`} error={state.issues?.title}><Input id={`title-${event.id}`} name="title" defaultValue={event.title} required maxLength={160} /></Field></div>
      <Field label="Category" htmlFor={`cat-${event.id}`}><Select id={`cat-${event.id}`} name="category" defaultValue={event.category}>{EVENT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select></Field>
      <Field label="How sure is the date?" htmlFor={`prec-${event.id}`}>
        <Select id={`prec-${event.id}`} name="datePrecision" defaultValue={event.datePrecision}>
          <option value="exact">Exact date</option><option value="month">Month and year</option><option value="year">Year</option><option value="approximate">Roughly that year</option><option value="decade">Sometime that decade</option><option value="unknown">Unknown</option>
        </Select>
      </Field>
      <Field label="Year" htmlFor={`year-${event.id}`} optional error={state.issues?.approximateYear}><Input id={`year-${event.id}`} name="approximateYear" inputMode="numeric" defaultValue={event.approximateYear ?? ""} /></Field>
      <Field label="Age at the time" htmlFor={`age-${event.id}`} optional error={state.issues?.approximateAge}><Input id={`age-${event.id}`} name="approximateAge" inputMode="numeric" defaultValue={event.approximateAge ?? ""} /></Field>
      <Field label="Exact start date" htmlFor={`start-${event.id}`} optional hint="YYYY-MM-DD, only if you know it." error={state.issues?.startDate}><Input id={`start-${event.id}`} name="startDate" defaultValue={event.startDate ?? ""} placeholder="1962-03-04" /></Field>
      <Field label="End date" htmlFor={`end-${event.id}`} optional error={state.issues?.endDate}><Input id={`end-${event.id}`} name="endDate" defaultValue={event.endDate ?? ""} placeholder="YYYY-MM-DD" /></Field>
      <div className="sm:col-span-2"><Field label="Place" htmlFor={`loc-${event.id}`} optional><Input id={`loc-${event.id}`} name="location" defaultValue={event.location ?? ""} maxLength={160} /></Field></div>
      <div className="sm:col-span-2"><Field label="What happened" htmlFor={`desc-${event.id}`}><Textarea id={`desc-${event.id}`} name="description" defaultValue={event.description} className="min-h-[5rem]" maxLength={2000} /></Field></div>
      <div className="sm:col-span-2"><Field label="Your note" htmlFor={`note-${event.id}`} optional hint="Context for yourself or the book; not sent to the interviewer."><Textarea id={`note-${event.id}`} name="userNote" defaultValue={event.userNote ?? ""} className="min-h-[3.5rem]" maxLength={600} /></Field></div>
      <div className="sm:col-span-2"><FormMessage error={state.error} /></div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" loading={pending}>Save event</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
