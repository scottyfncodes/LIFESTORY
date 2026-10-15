"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { updatePersonAction, type MemoryActionState } from "@/app/(app)/projects/[projectId]/memory-actions";

export type PersonFormValues = {
  preferredName: string;
  fullName: string | null;
  aliases: string[];
  relationshipToNarrator: string | null;
  description: string | null;
  notes: string | null;
  birthDate: string | null;
  deathDate: string | null;
  datePrecision: string;
};

export function PersonForm({ projectId, personId, initial }: { projectId: string; personId: string; initial: PersonFormValues }) {
  const action = updatePersonAction.bind(null, projectId, personId);
  const [state, formAction, pending] = useActionState<MemoryActionState, FormData>(action, {});
  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="Preferred name" htmlFor="preferredName" error={state.issues?.preferredName}><Input id="preferredName" name="preferredName" defaultValue={initial.preferredName} required maxLength={120} /></Field>
      <Field label="Full name" htmlFor="fullName" optional><Input id="fullName" name="fullName" defaultValue={initial.fullName ?? ""} maxLength={160} /></Field>
      <Field label="Also known as" htmlFor="aliases" optional hint="Nicknames or other spellings, separated by commas."><Input id="aliases" name="aliases" defaultValue={initial.aliases.join(", ")} maxLength={400} /></Field>
      <Field label="Relationship to the narrator" htmlFor="relationshipToNarrator" optional><Input id="relationshipToNarrator" name="relationshipToNarrator" defaultValue={initial.relationshipToNarrator ?? ""} placeholder="e.g. grandmother, childhood friend" maxLength={120} /></Field>
      <Field label="Born" htmlFor="birthDate" optional hint="YYYY-MM-DD" error={state.issues?.birthDate}><Input id="birthDate" name="birthDate" defaultValue={initial.birthDate ?? ""} placeholder="1921-06-30" /></Field>
      <Field label="Died" htmlFor="deathDate" optional hint="YYYY-MM-DD" error={state.issues?.deathDate}><Input id="deathDate" name="deathDate" defaultValue={initial.deathDate ?? ""} /></Field>
      <Field label="How sure are these dates?" htmlFor="datePrecision"><Select id="datePrecision" name="datePrecision" defaultValue={initial.datePrecision}><option value="exact">Exact</option><option value="year">Year only</option><option value="approximate">Approximate</option><option value="unknown">Unknown</option></Select></Field>
      <div className="sm:col-span-2"><Field label="Description" htmlFor="description" optional><Textarea id="description" name="description" defaultValue={initial.description ?? ""} className="min-h-[4rem]" maxLength={600} /></Field></div>
      <div className="sm:col-span-2"><Field label="Your notes" htmlFor="notes" optional hint="Private notes for you; not used by the interviewer."><Textarea id="notes" name="notes" defaultValue={initial.notes ?? ""} className="min-h-[3.5rem]" maxLength={1000} /></Field></div>
      <div className="sm:col-span-2"><FormMessage error={state.error} success={state.success} /></div>
      <div className="sm:col-span-2"><Button type="submit" loading={pending}>Save person</Button></div>
    </form>
  );
}
