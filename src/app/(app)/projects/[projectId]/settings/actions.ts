"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { flattenIssues, updateProjectSchema } from "@/lib/validation/project";
import { AppError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { updateProjectSettings } from "@/server/projects";
import { requireUserOrThrow } from "@/server/session";

export type SettingsState = {
  error?: string | null;
  success?: string | null;
  issues?: Record<string, string[]>;
};

export async function updateSettingsAction(
  projectId: string,
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const values = Object.fromEntries(
    Array.from(formData.entries()).filter(([, v]) => typeof v === "string") as [string, string][],
  );
  const parsed = updateProjectSchema.safeParse(values);
  if (!parsed.success) return { issues: flattenIssues(parsed.error) };
  try {
    const user = await requireUserOrThrow();
    const db = await getDb();
    await enforceRateLimit(db, "mutation", user.id);
    await updateProjectSettings(db, user.id, projectId, parsed.data);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "We couldn't save those changes. Please try again." };
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  return { success: "Settings saved." };
}
