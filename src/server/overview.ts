import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import {
  interviewSessions,
  interviewTurns,
  lifeEvents,
  manuscriptChapters,
  people,
  storyThreads,
} from "@/db/schema";

export async function getProjectOverview(db: DbClient, projectId: string) {
  const [answers] = await db
    .select({ count: sql<number>`count(*)` })
    .from(interviewTurns)
    .where(and(eq(interviewTurns.projectId, projectId), eq(interviewTurns.speakerType, "narrator")));
  const [sessionsCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(interviewSessions)
    .where(eq(interviewSessions.projectId, projectId));
  const [events] = await db
    .select({ count: sql<number>`count(*)` })
    .from(lifeEvents)
    .where(and(eq(lifeEvents.projectId, projectId), inArray(lifeEvents.status, ["confirmed", "proposed"])));
  const [persons] = await db
    .select({ count: sql<number>`count(*)` })
    .from(people)
    .where(and(eq(people.projectId, projectId), inArray(people.status, ["confirmed", "proposed"])));
  const chapters = await db
    .select({
      id: manuscriptChapters.id,
      title: manuscriptChapters.title,
      status: manuscriptChapters.chapterStatus,
      needsUpdate: manuscriptChapters.needsUpdate,
    })
    .from(manuscriptChapters)
    .where(eq(manuscriptChapters.projectId, projectId))
    .orderBy(asc(manuscriptChapters.chapterOrder));
  const openSession = await db.query.interviewSessions.findFirst({
    where: and(eq(interviewSessions.projectId, projectId), inArray(interviewSessions.sessionStatus, ["active", "paused"])),
    orderBy: desc(interviewSessions.lastActivityAt),
  });
  const latest = await db.query.interviewSessions.findFirst({
    where: eq(interviewSessions.projectId, projectId),
    orderBy: desc(interviewSessions.lastActivityAt),
  });
  const openThreads = await db
    .select({ id: storyThreads.id, title: storyThreads.title, suggestedFollowUp: storyThreads.suggestedFollowUp })
    .from(storyThreads)
    .where(and(eq(storyThreads.projectId, projectId), inArray(storyThreads.status, ["open", "in_progress"])))
    .orderBy(desc(storyThreads.importance), desc(storyThreads.updatedAt))
    .limit(5);

  return {
    answerCount: Number(answers?.count ?? 0),
    sessionCount: Number(sessionsCount?.count ?? 0),
    eventCount: Number(events?.count ?? 0),
    peopleCount: Number(persons?.count ?? 0),
    chapterCount: chapters.length,
    chapters,
    openSession: openSession ? { id: openSession.id, status: openSession.sessionStatus } : null,
    lastActivityAt: latest?.lastActivityAt ?? null,
    openThreads,
  };
}
