import { eq } from "drizzle-orm";
import type { DbClient } from "@/db";
import { interviewTurns, type TurnMetadata } from "@/db/schema";

/**
 * Biographical memory pipeline entry point. Milestone 3 implements
 * extraction and reconciliation here; until then a processed turn is simply
 * marked so the UI can show that nothing is pending.
 */
export async function processTurn(db: DbClient, turnId: string): Promise<Record<string, unknown>> {
  const turn = await db.query.interviewTurns.findFirst({ where: eq(interviewTurns.id, turnId) });
  if (!turn) return { skipped: "missing_turn" };
  await db
    .update(interviewTurns)
    .set({ metadata: { ...(turn.metadata as TurnMetadata), processingStatus: "processed" } })
    .where(eq(interviewTurns.id, turnId));
  return { processed: true };
}
