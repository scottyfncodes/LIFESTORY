"use client";

import { useActionState } from "react";
import { updateSettingsAction, type SettingsState } from "@/app/(app)/projects/[projectId]/settings/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { INTENDED_SCOPES, WRITING_STYLES } from "@/lib/validation/project";

type Initial = {
  title: string;
  narratorName: string;
  intendedScope: string;
  scopeDescription: string;
  writingStyle: string;
  topicsToAvoid: string;
  retainAudioDays: string;
};

export function SettingsForm({ projectId, initial, disabled }: { projectId: string; initial: Initial; disabled: boolean }) {
  const action = updateSettingsAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(action, {});
  return (
    <form action={formAction} className="mt-6 space-y-5" noValidate>
      <fieldset disabled={disabled} className="space-y-5">
        <Field label="Title" htmlFor="title" error={state.issues?.title}>
          <Input id="title" name="title" defaultValue={initial.title} maxLength={120} required />
        </Field>
        <Field label="Narrator's preferred name" htmlFor="narratorName" error={state.issues?.narratorName}>
          <Input id="narratorName" name="narratorName" defaultValue={initial.narratorName} maxLength={80} required />
        </Field>
        <Field label="Scope" htmlFor="intendedScope">
          <Select id="intendedScope" name="intendedScope" defaultValue={initial.intendedScope}>
            {INTENDED_SCOPES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Specific focus" htmlFor="scopeDescription" optional>
          <Textarea id="scopeDescription" name="scopeDescription" defaultValue={initial.scopeDescription} className="min-h-[5rem]" maxLength={400} />
        </Field>
        <Field label="Writing style" htmlFor="writingStyle">
          <Select id="writingStyle" name="writingStyle" defaultValue={initial.writingStyle}>
            {WRITING_STYLES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Topics to leave out" htmlFor="topicsToAvoid" optional hint="One per line. The interviewer will not raise these.">
          <Textarea id="topicsToAvoid" name="topicsToAvoid" defaultValue={initial.topicsToAvoid} className="min-h-[5rem]" maxLength={1000} />
        </Field>
        <Field label="Keep audio recordings for" htmlFor="retainAudioDays" hint="Transcripts are always kept. Audio is deleted after this period unless you delete it sooner.">
          <Select id="retainAudioDays" name="retainAudioDays" defaultValue={initial.retainAudioDays}>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">One year</option>
            <option value="keep">Until I delete them</option>
          </Select>
        </Field>
      </fieldset>
      <FormMessage error={state.error} success={state.success} />
      {!disabled ? (
        <div className="flex justify-end">
          <Button type="submit" loading={pending}>Save settings</Button>
        </div>
      ) : null}
    </form>
  );
}
