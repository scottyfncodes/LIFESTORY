"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { mergePeopleAction, setPersonStatusAction } from "@/app/(app)/projects/[projectId]/memory-actions";

export function PersonTools({ projectId, personId, status, others }: { projectId: string; personId: string; status: string; others: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-8 space-y-4 border-t border-line pt-6">
      {status === "proposed" ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={pending} onClick={() => startTransition(async () => { const r = await setPersonStatusAction(projectId, personId, "confirmed"); if (r.error) setError(r.error); else router.refresh(); })}>Confirm this person</Button>
        </div>
      ) : null}
      {others.length > 0 ? (
        <form action={async (fd) => { const r = await mergePeopleAction(projectId, personId, fd); if (r.error) setError(r.error); else router.refresh(); }} className="space-y-2">
          <p className="text-[0.9rem] font-medium text-ink">Same person listed twice?</p>
          <div className="flex flex-wrap gap-2">
            <Select name="duplicateId" defaultValue="" className="h-10 w-full sm:w-64 text-[0.9rem]" aria-label="Person to merge into this one">
              <option value="" disabled>Choose the duplicate…</option>
              {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
            <Button type="submit" size="sm" variant="secondary">Merge into this person</Button>
          </div>
          <p className="text-[0.8rem] text-ink-3">The other entry&rsquo;s name becomes an alias here; events and stories move across. Answers stay as they were.</p>
        </form>
      ) : null}
      <button type="button" disabled={pending} onClick={() => { if (window.confirm("Remove this person from the list? Your answers are not changed.")) startTransition(async () => { const r = await setPersonStatusAction(projectId, personId, "rejected"); if (r.error) setError(r.error); else router.push(`/projects/${projectId}/people`); }); }} className="text-[0.85rem] text-ink-3 hover:text-rose">Remove from people</button>
      {error ? <p className="text-[0.85rem] text-rose" role="alert">{error}</p> : null}
    </div>
  );
}
