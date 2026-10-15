"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { createProjectSchema, flattenIssues } from "@/lib/validation/project";
import { createProject } from "@/server/projects";
import { requireUserOrThrow } from "@/server/session";
import { enforceRateLimit } from "@/server/rate-limit";
import { AppError } from "@/server/errors";

export type CreateProjectState = {
  error?: string | null;
  issues?: Record<string, string[]>;
  values?: Record<string, string>;
};

export async function createProjectAction(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const values = Object.fromEntries(
    Array.from(formData.entries()).filter(([, v]) => typeof v === "string") as [string, string][],
  );
  const parsed = createProjectSchema.safeParse(values);
  if (!parsed.success) {
    return { issues: flattenIssues(parsed.error), values };
  }
  let projectId: string;
  try {
    const user = await requireUserOrThrow();
    const db = await getDb();
    await enforceRateLimit(db, "projectCreate", user.id);
    const created = await createProject(db, user.id, parsed.data);
    projectId = created.id;
  } catch (error) {
    if (error instanceof AppError) return { error: error.message, values };
    return { error: "We couldn't create the project. Please try again.", values };
  }
  redirect(`/projects/${projectId}/interview?welcome=1`);
}
