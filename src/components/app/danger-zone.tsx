"use client";

import { useActionState, useState } from "react";
import { Download } from "lucide-react";
import { deleteProjectAction, type DeleteState } from "@/app/(app)/projects/[projectId]/settings/danger-actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";

export function DangerZone({ projectId, title, canDelete, canExport, recordingCount }: { projectId: string; title: string; canDelete: boolean; canExport: boolean; recordingCount: number }) {
  const [open, setOpen] = useState(false);
  const action = deleteProjectAction.bind(null, projectId, title);
  const [state, formAction, pending] = useActionState<DeleteState, FormData>(action, {});
  return (
    <section className="mt-10 space-y-6" aria-labelledby="data-heading">
      <h2 id="data-heading" className="font-serif text-[1.4rem] text-ink">Your data</h2>
      {canExport ? (
        <div className="rounded-[var(--radius-lg)] border border-line bg-white/80 p-4">
          <p className="font-medium text-ink">Export everything</p>
          <p className="mt-1 text-[0.9rem] leading-relaxed text-ink-2">A complete copy of this project: settings, every answer (original and corrected), people, events, notes, story threads and every revision of every chapter, as a JSON file. The book itself can be downloaded as PDF or Word from My Book.</p>
          <a href={`/api/projects/${projectId}/export?format=json`} className="mt-3 inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] border border-line bg-white px-3 text-[0.9rem] font-medium text-ink hover:bg-paper-2"><Download className="h-4 w-4" aria-hidden /> Download project data</a>
        </div>
      ) : null}
      {canDelete ? (
        <div className="rounded-[var(--radius-lg)] border border-rose/30 bg-white/80 p-4">
          <p className="font-medium text-ink">Delete this memoir</p>
          <p className="mt-1 text-[0.9rem] leading-relaxed text-ink-2">
            Deleting removes the project, all {recordingCount > 0 ? `${recordingCount} recording${recordingCount === 1 ? "" : "s"}, ` : ""}answers, transcripts, people, events, notes and every chapter revision. Access stops immediately; recordings are purged from storage within minutes. Database point-in-time history can hold a copy for up to 6 hours and provider backups for their own retention window, after which nothing remains. This cannot be undone.
          </p>
          {!open ? (
            <Button variant="danger" className="mt-3" onClick={() => setOpen(true)}>Delete this memoir…</Button>
          ) : (
            <form action={formAction} className="mt-4 space-y-3">
              <Field label={`Type "${title}" to confirm`} htmlFor="confirmTitle">
                <Input id="confirmTitle" name="confirmTitle" autoComplete="off" />
              </Field>
              <FormMessage error={state.error} />
              <div className="flex gap-2">
                <Button type="submit" variant="danger" loading={pending}>Permanently delete</Button>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Keep it</Button>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </section>
  );
}
