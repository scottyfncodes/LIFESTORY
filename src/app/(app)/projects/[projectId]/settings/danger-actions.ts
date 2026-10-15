"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { AppError } from "@/server/errors";
import { requestProjectDeletion } from "@/server/deletion";
import { drainJobsAfterResponse } from "@/server/jobs/drain";
import { enforceRateLimit } from "@/server/rate-limit";
import { requireUserOrThrow } from "@/server/session";

export type DeleteState = { error?: string | null };

export async function deleteProjectAction(projectId: string, expectedTitle: string, _prev: DeleteState, formData: FormData): Promise<DeleteState> {
  const typed = String(formData.get("confirmTitle") ?? "").trim();
  if (typed !== expectedTitle.trim()) return { error: "Type the memoir's title exactly to confirm." };
  try {
    const user = await requireUserOrThrow();
    const db = await getDb();
    await enforceRateLimit(db, "mutation", user.id);
    await requestProjectDeletion(db, user.id, projectId);
    drainJobsAfterResponse(projectId);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "We couldn't delete the project. Please try again." };
  }
  redirect("/home?deleted=1");
}
