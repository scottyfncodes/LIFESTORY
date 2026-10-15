"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, Select, Textarea } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";

type Participant = { key: string; displayName: string; personId: string; isAccountHolder: boolean };
type PersonOption = { id: string; name: string };

let nextKey = 0;
const key = () => `p${nextKey++}`;

export function CreateWeaveForm({ projectId, accountHolderName, people }: { projectId: string; accountHolderName: string; people: PersonOption[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [contextNote, setContextNote] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([
    { key: key(), displayName: accountHolderName, personId: "", isAccountHolder: true },
    { key: key(), displayName: "", personId: "", isAccountHolder: false },
  ]);
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string[]>>({});

  function update(k: string, patch: Partial<Participant>) {
    setParticipants((list) => list.map((p) => (p.key === k ? { ...p, ...patch } : p)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIssues({});
    const found: Record<string, string[]> = {};
    if (!title.trim()) found.title = ["Give the conversation a title."];
    if (participants.some((p) => !p.displayName.trim())) found.participants = ["Add a name for everyone listed, or remove the empty row."];
    if (Object.keys(found).length > 0) {
      setIssues(found);
      return;
    }
    if (!consent) {
      setError("Please confirm everyone agreed to be recorded.");
      return;
    }
    setPending(true);
    try {
      const { id } = await apiFetch<{ id: string }>(`/api/projects/${projectId}/weaves`, {
        method: "POST",
        body: JSON.stringify({
          title,
          contextNote,
          participantConsent: true,
          participants: participants.map((p) => ({ displayName: p.displayName, personId: p.personId || null, isAccountHolder: p.isAccountHolder })),
        }),
      });
      router.push(`/projects/${projectId}/weaves/${id}`);
    } catch (e) {
      setPending(false);
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <Field label="What was this conversation?" htmlFor="title" hint="For example: “Dad and Aunt June on the farm years”." error={issues.title}>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} autoComplete="off" />
      </Field>

      <fieldset className="space-y-3">
        <legend className="text-[0.9rem] font-medium text-ink">Who is speaking?</legend>
        <p className="text-[0.85rem] leading-relaxed text-ink-3">Name everyone whose voice is on the recordings, so their words can be told apart later.</p>
        <ul className="space-y-3">
          {participants.map((p, i) => (
            <li key={p.key} className="rounded-[var(--radius-md)] border border-line bg-white/80 p-3">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor={`name-${p.key}`}>{p.isAccountHolder ? "You" : `Person ${i + 1}`}</Label>
                  <Input id={`name-${p.key}`} value={p.displayName} onChange={(e) => update(p.key, { displayName: e.target.value })} maxLength={60} placeholder="Name" autoComplete="off" />
                </div>
                {participants.length > 2 && !p.isAccountHolder ? (
                  <Button variant="ghost" size="sm" className="h-11 w-11 px-0" aria-label={`Remove ${p.displayName || `person ${i + 1}`}`} onClick={() => setParticipants((list) => list.filter((x) => x.key !== p.key))}>
                    <X className="h-4 w-4" aria-hidden />
                  </Button>
                ) : null}
              </div>
              {!p.isAccountHolder && people.length > 0 ? (
                <div className="mt-2 space-y-1.5">
                  <Label htmlFor={`person-${p.key}`} className="text-[0.85rem] font-normal text-ink-2">Same as someone in your People list?</Label>
                  <Select
                    id={`person-${p.key}`}
                    value={p.personId}
                    onChange={(e) => {
                      const person = people.find((x) => x.id === e.target.value);
                      update(p.key, { personId: e.target.value, ...(person && !p.displayName ? { displayName: person.name } : {}) });
                    }}
                  >
                    <option value="">Not linked</option>
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>{person.name}</option>
                    ))}
                  </Select>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {issues.participants ? <p className="text-[0.85rem] text-rose" role="alert">{issues.participants.join(" ")}</p> : null}
        {participants.length < 6 ? (
          <Button variant="secondary" size="sm" onClick={() => setParticipants((list) => [...list, { key: key(), displayName: "", personId: "", isAccountHolder: false }])}>
            <Plus className="h-4 w-4" aria-hidden /> Add another person
          </Button>
        ) : null}
      </fieldset>

      <Field label="Anything to remember about it?" htmlFor="contextNote" optional hint="Where and when it happened, or what you were talking about." error={issues.contextNote}>
        <Textarea id="contextNote" value={contextNote} onChange={(e) => setContextNote(e.target.value)} maxLength={2000} className="min-h-[5rem]" />
      </Field>

      <label className="flex items-start gap-3 rounded-[var(--radius-md)] border border-line bg-white/80 p-3 text-[0.925rem] leading-relaxed text-ink-2">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-clay)]" />
        <span>Everyone on these recordings knew they were being recorded and agreed to the recordings being kept privately in this memoir.</span>
      </label>

      <FormMessage error={error} />
      <Button type="submit" size="lg" loading={pending} className="w-full sm:w-auto">Create conversation</Button>
    </form>
  );
}
