import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import {
  consentRecords,
  interviewSessions,
  interviewTurns,
  manuscriptChapters,
  memoirProjects,
  projectMemberships,
  type PrivacySettings,
} from "@/db/schema";
import type { CreateProjectInput, UpdateProjectInput } from "@/lib/validation/project";
import { recordAudit } from "./audit";
import { requireProjectAccess, type ProjectAccess } from "./authz";

export const POLICY_VERSION = "2026-10-15";

export type ProjectSummary = {
  id: string;
  title: string;
  narratorName: string;
  projectType: "self_guided" | "hosted";
  intendedScope: string;
  updatedAt: Date;
  role: string;
  answerCount: number;
  chapterCount: number;
  latestSession: {
    id: string;
    status: string;
    lastActivityAt: Date;
  } | null;
};

export async function createProject(
  db: DbClient,
  userId: string,
  input: CreateProjectInput,
): Promise<{ id: string }> {
  const narratorIsUser = input.narratorIsUser === "yes";
  const projectType = narratorIsUser ? "self_guided" : "hosted";
  const privacy: PrivacySettings = {
    visibility: "private",
    allowAiProcessing: true,
    retainAudioDays: Number(process.env.DEFAULT_AUDIO_RETENTION_DAYS ?? 90) || 90,
  };

  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(memoirProjects)
      .values({
        ownerUserId: userId,
        title: input.title,
        narratorName: input.narratorName,
        narratorUserId: narratorIsUser ? userId : null,
        projectType,
        intendedScope: input.intendedScope,
        scopeDescription: input.scopeDescription || null,
        writingStyle: input.writingStyle,
        topicsToAvoid: input.topicsToAvoid,
        privacySettings: privacy,
      })
      .returning({ id: memoirProjects.id });

    await tx.insert(projectMemberships).values({
      projectId: project.id,
      userId,
      role: "owner",
      invitationStatus: "accepted",
    });

    await tx.insert(consentRecords).values([
      {
        projectId: project.id,
        subjectUserId: userId,
        consentType: "privacy_acknowledgment",
        consentStatus: "granted",
        policyVersion: POLICY_VERSION,
      },
      {
        projectId: project.id,
        subjectUserId: userId,
        consentType: "ai_processing",
        consentStatus: "granted",
        policyVersion: POLICY_VERSION,
      },
    ]);

    await recordAudit(tx, {
      projectId: project.id,
      actorUserId: userId,
      actionType: "project.create",
      targetType: "memoir_project",
      targetId: project.id,
    });

    return { id: project.id };
  });
}

export async function listProjectsForUser(db: DbClient, userId: string): Promise<ProjectSummary[]> {
  const rows = await db
    .select({
      project: memoirProjects,
      role: projectMemberships.role,
    })
    .from(memoirProjects)
    .leftJoin(
      projectMemberships,
      and(
        eq(projectMemberships.projectId, memoirProjects.id),
        eq(projectMemberships.userId, userId),
        eq(projectMemberships.invitationStatus, "accepted"),
        isNull(projectMemberships.revokedAt),
      ),
    )
    .where(
      and(
        isNull(memoirProjects.deletedAt),
        or(eq(memoirProjects.ownerUserId, userId), sql`${projectMemberships.id} is not null`),
      ),
    )
    .orderBy(desc(memoirProjects.updatedAt));

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.project.id);

  const answerCounts = await db
    .select({ projectId: interviewTurns.projectId, count: sql<number>`count(*)` })
    .from(interviewTurns)
    .where(and(inArray(interviewTurns.projectId, ids), eq(interviewTurns.speakerType, "narrator")))
    .groupBy(interviewTurns.projectId);

  const chapterCounts = await db
    .select({ projectId: manuscriptChapters.projectId, count: sql<number>`count(*)` })
    .from(manuscriptChapters)
    .where(inArray(manuscriptChapters.projectId, ids))
    .groupBy(manuscriptChapters.projectId);

  const sessions = await db
    .select({
      id: interviewSessions.id,
      projectId: interviewSessions.projectId,
      status: interviewSessions.sessionStatus,
      lastActivityAt: interviewSessions.lastActivityAt,
    })
    .from(interviewSessions)
    .where(inArray(interviewSessions.projectId, ids))
    .orderBy(desc(interviewSessions.lastActivityAt));

  const answerMap = new Map(answerCounts.map((r) => [r.projectId, Number(r.count)]));
  const chapterMap = new Map(chapterCounts.map((r) => [r.projectId, Number(r.count)]));
  const latestSessionMap = new Map<string, (typeof sessions)[number]>();
  for (const s of sessions) if (!latestSessionMap.has(s.projectId)) latestSessionMap.set(s.projectId, s);

  return rows.map(({ project, role }) => {
    const latest = latestSessionMap.get(project.id);
    return {
      id: project.id,
      title: project.title,
      narratorName: project.narratorName,
      projectType: project.projectType,
      intendedScope: project.intendedScope,
      updatedAt: project.updatedAt,
      role: project.ownerUserId === userId ? "owner" : (role ?? "viewer"),
      answerCount: answerMap.get(project.id) ?? 0,
      chapterCount: chapterMap.get(project.id) ?? 0,
      latestSession: latest
        ? { id: latest.id, status: latest.status, lastActivityAt: latest.lastActivityAt }
        : null,
    };
  });
}

export async function getProjectForUser(
  db: DbClient,
  userId: string,
  projectId: string,
): Promise<ProjectAccess> {
  return requireProjectAccess(db, userId, projectId, "project:read");
}

export async function updateProjectSettings(
  db: DbClient,
  userId: string,
  projectId: string,
  input: UpdateProjectInput,
): Promise<void> {
  const access = await requireProjectAccess(db, userId, projectId, "project:manage");
  const retainAudioDays = input.retainAudioDays === "keep" ? null : Number(input.retainAudioDays);
  await db
    .update(memoirProjects)
    .set({
      title: input.title,
      narratorName: input.narratorName,
      intendedScope: input.intendedScope,
      scopeDescription: input.scopeDescription || null,
      writingStyle: input.writingStyle,
      topicsToAvoid: input.topicsToAvoid,
      privacySettings: { ...access.project.privacySettings, retainAudioDays },
    })
    .where(eq(memoirProjects.id, projectId));
  await recordAudit(db, {
    projectId,
    actorUserId: userId,
    actionType: "project.update_settings",
    targetType: "memoir_project",
    targetId: projectId,
  });
}

export async function touchProject(db: DbClient, projectId: string): Promise<void> {
  await db
    .update(memoirProjects)
    .set({ updatedAt: new Date() })
    .where(eq(memoirProjects.id, projectId));
}
