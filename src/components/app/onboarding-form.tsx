"use client";

import { useActionState, useState } from "react";
import { createProjectAction, type CreateProjectState } from "@/app/(app)/projects/new/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { INTENDED_SCOPES, WRITING_STYLES } from "@/lib/validation/project";
import { cn } from "@/lib/utils/cn";

export function OnboardingForm({ userName, defaultNarratorIsUser }: { userName: string; defaultNarratorIsUser: "yes" | "no" }) {
  const [state, formAction, pending] = useActionState<CreateProjectState, FormData>(createProjectAction, {});
  const v = state.values ?? {};
  const [narratorIsUser, setNarratorIsUser] = useState<"yes" | "no">((v.narratorIsUser as "yes" | "no") ?? defaultNarratorIsUser);
  const firstName = userName.split(" ")[0] || userName;

  return (
    <form action={formAction} className="mt-8 space-y-8" noValidate>
      <fieldset className="space-y-3">
        <legend className="text-[0.9rem] font-medium text-ink">Whose story is this?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <RadioCard
            name="narratorIsUser"
            value="yes"
            checked={narratorIsUser === "yes"}
            onChange={() => setNarratorIsUser("yes")}
            title="My life"
            text="I'll answer the questions myself, in my own time."
          />
          <RadioCard
            name="narratorIsUser"
            value="no"
            checked={narratorIsUser === "no"}
            onChange={() => setNarratorIsUser("no")}
            title="Together"
            text="I'll sit with someone and run the interview with them."
          />
        </div>
        {state.issues?.narratorIsUser ? <p className="text-[0.85rem] text-rose" role="alert">{state.issues.narratorIsUser.join(" ")}</p> : null}
      </fieldset>

      <div className="space-y-5">
        <Field label="Narrator's preferred name" htmlFor="narratorName" hint="How the interviewer should address the person telling the story.">
          <Input id="narratorName" name="narratorName" defaultValue={v.narratorName ?? (narratorIsUser === "yes" ? firstName : "")} maxLength={80} required />
        </Field>
        <Field label="Working title" htmlFor="title" hint="A placeholder is fine. Many people change it once the book takes shape.">
          <Input id="title" name="title" defaultValue={v.title ?? ""} placeholder="e.g. A Long Way From Elm Street" maxLength={120} required />
        </Field>
        {state.issues?.title ? <p className="-mt-3 text-[0.85rem] text-rose" role="alert">{state.issues.title.join(" ")}</p> : null}
        <Field label="What should this memoir cover?" htmlFor="intendedScope">
          <Select id="intendedScope" name="intendedScope" defaultValue={v.intendedScope ?? "full_life"}>
            {INTENDED_SCOPES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Anything specific in mind?" htmlFor="scopeDescription" optional hint="For example, the years in Manchester, or the story behind the family business.">
          <Textarea id="scopeDescription" name="scopeDescription" defaultValue={v.scopeDescription ?? ""} maxLength={400} className="min-h-[5rem]" />
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-[0.9rem] font-medium text-ink">Writing style</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {WRITING_STYLES.map((s) => (
            <RadioCard
              key={s.value}
              name="writingStyle"
              value={s.value}
              defaultChecked={(v.writingStyle ?? "warm_literary") === s.value}
              title={s.label}
              text={s.description}
            />
          ))}
        </div>
      </fieldset>

      <Field label="Topics to leave out" htmlFor="topicsToAvoid" optional hint="The interviewer will steer clear of these. One per line.">
        <Textarea id="topicsToAvoid" name="topicsToAvoid" defaultValue={v.topicsToAvoid ?? ""} className="min-h-[5rem]" maxLength={1000} />
      </Field>

      <div className="rounded-[var(--radius-md)] border border-line bg-paper-2/70 p-4 text-[0.9rem] leading-relaxed text-ink-2">
        <label className="flex items-start gap-3">
          <input type="checkbox" name="acknowledgePrivacy" className="mt-1 h-4 w-4 accent-clay" defaultChecked={v.acknowledgePrivacy === "on"} />
          <span>
            I understand this project is private to me, that answers and recordings are processed by the configured AI and transcription services to run the interview and draft the book, and that AI-written passages need my review.{" "}
            <a href="/privacy" target="_blank" rel="noreferrer" className="font-medium text-clay hover:text-clay-2">How data is handled</a>
          </span>
        </label>
        {state.issues?.acknowledgePrivacy ? <p className="mt-2 text-[0.85rem] text-rose" role="alert">{state.issues.acknowledgePrivacy.join(" ")}</p> : null}
      </div>

      <FormMessage error={state.error} />

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button type="submit" size="lg" loading={pending}>
          Start the first conversation
        </Button>
      </div>
    </form>
  );
}

function RadioCard({
  name,
  value,
  title,
  text,
  checked,
  defaultChecked,
  onChange,
}: {
  name: string;
  value: string;
  title: string;
  text: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-[var(--radius-md)] border bg-white p-4 transition-colors has-[:checked]:border-clay has-[:checked]:bg-clay-soft/50",
        "border-line hover:border-line-2",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={onChange}
        className="mt-1 h-4 w-4 shrink-0 accent-clay"
      />
      <span>
        <span className="block font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-[0.875rem] leading-relaxed text-ink-2">{text}</span>
      </span>
    </label>
  );
}
