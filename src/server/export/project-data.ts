import { asc, eq } from "drizzle-orm";
import type { DbClient } from "@/db";
import {
  consentRecords,
  interviewSessions,
  interviewTurns,
  lifeEvents,
  manuscriptChapters,
  manuscriptRevisions,
  manuscriptSources,
  mediaAssets,
  memoryFacts,
  people,
  relationships,
  storyThreads,
} from "@/db/schema";
import { requireProjectAccess } from "../authz";

/**
 * Complete, machine-readable export of a project: settings, every answer
 * (original and corrected), memory records with their sources, and every
 * manuscript revision. Recordings are referenced by id, not embedded.
 */
export async function exportProjectData(db: DbClient, userId: string, projectId: string) {
  const access = await requireProjectAccess(db, userId, projectId, "export");
  const { project } = access;
  const [sessions, turns, media, persons, rels, events, facts, threads, chapters, revisions, sources, consents] = await Promise.all([
    db.select().from(interviewSessions).where(eq(interviewSessions.projectId, projectId)).orderBy(asc(interviewSessions.startedAt)),
    db.select().from(interviewTurns).where(eq(interviewTurns.projectId, projectId)).orderBy(asc(interviewTurns.createdAt), asc(interviewTurns.sequenceNumber)),
    db.select({ id: mediaAssets.id, turnId: mediaAssets.interviewTurnId, mediaType: mediaAssets.mediaType, durationSeconds: mediaAssets.durationSeconds, status: mediaAssets.processingStatus, retentionStatus: mediaAssets.retentionStatus, createdAt: mediaAssets.createdAt, deletedAt: mediaAssets.deletedAt }).from(mediaAssets).where(eq(mediaAssets.projectId, projectId)),
    db.select().from(people).where(eq(people.projectId, projectId)),
    db.select().from(relationships).where(eq(relationships.projectId, projectId)),
    db.select().from(lifeEvents).where(eq(lifeEvents.projectId, projectId)),
    db.select().from(memoryFacts).where(eq(memoryFacts.projectId, projectId)),
    db.select().from(storyThreads).where(eq(storyThreads.projectId, projectId)),
    db.select().from(manuscriptChapters).where(eq(manuscriptChapters.projectId, projectId)).orderBy(asc(manuscriptChapters.chapterOrder)),
    db.select().from(manuscriptRevisions).where(eq(manuscriptRevisions.projectId, projectId)).orderBy(asc(manuscriptRevisions.createdAt)),
    db.select().from(manuscriptSources),
    db.select({ consentType: consentRecords.consentType, consentStatus: consentRecords.consentStatus, policyVersion: consentRecords.policyVersion, recordedAt: consentRecords.recordedAt, revokedAt: consentRecords.revokedAt }).from(consentRecords).where(eq(consentRecords.projectId, projectId)),
  ]);
  const revisionIds = new Set(revisions.map((r) => r.id));
  return {
    format: "lifestory.project.v1",
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      narratorName: project.narratorName,
      projectType: project.projectType,
      intendedScope: project.intendedScope,
      scopeDescription: project.scopeDescription,
      writingStyle: project.writingStyle,
      topicsToAvoid: project.topicsToAvoid,
      privacySettings: project.privacySettings,
      biographySummary: project.biographySummary,
      createdAt: project.createdAt,
    },
    consents,
    sessions: sessions.map((s) => ({ id: s.id, status: s.sessionStatus, mode: s.mode, startedAt: s.startedAt, endedAt: s.endedAt })),
    turns: turns.map((t) => ({ id: t.id, sessionId: t.sessionId, sequenceNumber: t.sequenceNumber, speaker: t.speakerType, inputMode: t.inputMode, originalText: t.originalText, correctedText: t.correctedText, skipped: Boolean(t.metadata.skipped), createdAt: t.createdAt })),
    recordings: media,
    people: persons,
    relationships: rels,
    events,
    facts,
    threads,
    chapters: chapters.map((c) => ({ ...c, revisions: revisions.filter((r) => r.chapterId === c.id).map((r) => ({ ...r, sourceTurnIds: sources.filter((s) => s.revisionId === r.id && revisionIds.has(r.id)).map((s) => s.sourceTurnId) })) })),
  };
}
