import type { DbClient } from "@/db";
import { auditEvents } from "@/db/schema";

/**
 * Records that an action happened. Deliberately content-free: identifiers only.
 */
export async function recordAudit(
  db: DbClient,
  input: {
    projectId?: string | null;
    actorUserId?: string | null;
    actionType: string;
    targetType: string;
    targetId?: string | null;
  },
): Promise<void> {
  await db.insert(auditEvents).values({
    projectId: input.projectId ?? null,
    actorUserId: input.actorUserId ?? null,
    actionType: input.actionType,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
  });
}
