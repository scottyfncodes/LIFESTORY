"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { flattenIssues } from "@/lib/validation/project";
import { idSchema, updateEventSchema, updatePersonSchema } from "@/lib/validation/memory";
import { AppError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { requireUserOrThrow } from "@/server/session";
import {
  mergeEvents,
  mergePeople,
  reorderEvents,
  resolveFact,
  setEventStatus,
  setPersonStatus,
  setThreadStatus,
  updateEvent,
  updatePerson,
} from "@/server/memory/service";

export type MemoryActionState = { error?: string | null; success?: string | null; issues?: Record<string, string[]> };

function values(formData: FormData): Record<string, string> {
  return Object.fromEntries(Array.from(formData.entries()).filter(([, v]) => typeof v === "string") as [string, string][]);
}

async function guarded(projectId: string, run: (userId: string) => Promise<void>, revalidate: string[] = []): Promise<MemoryActionState> {
  try {
    const user = await requireUserOrThrow();
    const db = await getDb();
    await enforceRateLimit(db, "mutation", user.id);
    await run(user.id);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "We couldn't save that change. Please try again." };
  }
  for (const path of revalidate.length ? revalidate : [`/projects/${projectId}`]) revalidatePath(path, "layout");
  return { success: "Saved." };
}

export async function updatePersonAction(projectId: string, personId: string, _prev: MemoryActionState, formData: FormData): Promise<MemoryActionState> {
  const parsed = updatePersonSchema.safeParse(values(formData));
  if (!parsed.success) return { issues: flattenIssues(parsed.error) };
  return guarded(projectId, async (userId) => {
    const db = await getDb();
    await updatePerson(db, userId, projectId, personId, parsed.data);
  });
}

export async function updateEventAction(projectId: string, eventId: string, _prev: MemoryActionState, formData: FormData): Promise<MemoryActionState> {
  const parsed = updateEventSchema.safeParse(values(formData));
  if (!parsed.success) return { issues: flattenIssues(parsed.error) };
  return guarded(projectId, async (userId) => {
    const db = await getDb();
    await updateEvent(db, userId, projectId, eventId, parsed.data);
  });
}

export async function mergePeopleAction(projectId: string, keepId: string, formData: FormData): Promise<MemoryActionState> {
  const duplicateId = idSchema.safeParse(formData.get("duplicateId"));
  if (!duplicateId.success) return { error: "Choose a person to merge." };
  return guarded(projectId, async (userId) => {
    const db = await getDb();
    await mergePeople(db, userId, projectId, keepId, duplicateId.data);
  });
}

export async function mergeEventsAction(projectId: string, keepId: string, formData: FormData): Promise<MemoryActionState> {
  const duplicateId = idSchema.safeParse(formData.get("duplicateId"));
  if (!duplicateId.success) return { error: "Choose an event to merge." };
  return guarded(projectId, async (userId) => {
    const db = await getDb();
    await mergeEvents(db, userId, projectId, keepId, duplicateId.data);
  });
}

export async function setPersonStatusAction(projectId: string, personId: string, status: "confirmed" | "rejected"): Promise<MemoryActionState> {
  return guarded(projectId, async (userId) => {
    const db = await getDb();
    await setPersonStatus(db, userId, projectId, personId, status);
  });
}

export async function setEventStatusAction(projectId: string, eventId: string, status: "confirmed" | "rejected"): Promise<MemoryActionState> {
  return guarded(projectId, async (userId) => {
    const db = await getDb();
    await setEventStatus(db, userId, projectId, eventId, status);
  });
}

export async function resolveFactAction(projectId: string, factId: string, decision: "confirm" | "reject"): Promise<MemoryActionState> {
  return guarded(projectId, async (userId) => {
    const db = await getDb();
    await resolveFact(db, userId, projectId, factId, decision);
  });
}

export async function moveEventAction(projectId: string, orderedIds: string[]): Promise<MemoryActionState> {
  const ids = orderedIds.filter((id) => idSchema.safeParse(id).success).slice(0, 500);
  return guarded(projectId, async (userId) => {
    const db = await getDb();
    await reorderEvents(db, userId, projectId, ids);
  });
}

export async function setThreadStatusAction(projectId: string, threadId: string, status: "open" | "deferred" | "excluded"): Promise<MemoryActionState> {
  return guarded(projectId, async (userId) => {
    const db = await getDb();
    await setThreadStatus(db, userId, projectId, threadId, status);
  });
}
