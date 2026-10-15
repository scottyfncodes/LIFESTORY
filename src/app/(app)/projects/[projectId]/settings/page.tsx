import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { SettingsForm } from "@/components/app/settings-form";
import { Notice } from "@/components/ui/notice";
import { getProjectAccess } from "@/server/authz";
import { requireUser } from "@/server/session";
import { describeProviders } from "@/server/config";
import { DangerZone } from "@/components/app/danger-zone";
import { and, eq, isNull, sql } from "drizzle-orm";
import { mediaAssets } from "@/db/schema";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireUser();
  const db = await getDb();
  const access = await getProjectAccess(db, user.id, projectId);
  if (!access) notFound();
  const canManage = access.permissions.has("project:manage");
  const providers = describeProviders();
  const { project } = access;
  const [{ count: recordingCount }] = await db.select({ count: sql<number>`count(*)` }).from(mediaAssets).where(and(eq(mediaAssets.projectId, projectId), isNull(mediaAssets.deletedAt)));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8" style={{ paddingBottom: "calc(2rem + var(--safe-bottom))" }}>
      <h1 className="font-serif text-[1.9rem] leading-tight text-ink">Project settings</h1>
      <p className="mt-1 text-[0.95rem] text-ink-2">Names, scope, writing preferences and how recordings are kept.</p>

      {!canManage ? (
        <Notice className="mt-6" tone="info">Only the project owner can change these settings.</Notice>
      ) : null}

      <SettingsForm
        projectId={project.id}
        disabled={!canManage}
        initial={{
          title: project.title,
          narratorName: project.narratorName,
          intendedScope: project.intendedScope,
          scopeDescription: project.scopeDescription ?? "",
          writingStyle: project.writingStyle,
          topicsToAvoid: project.topicsToAvoid.join("\n"),
          retainAudioDays: project.privacySettings.retainAudioDays === null ? "keep" : String(project.privacySettings.retainAudioDays),
        }}
      />

      <section className="mt-10" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading" className="font-serif text-[1.4rem] text-ink">Privacy and processing</h2>
        <dl className="mt-3 divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-white/80 text-[0.925rem]">
          <Row label="Visibility" value="Private. Only you can open this project." />
          <Row label="AI interviewer and drafting" value={providers.ai} />
          <Row label="Voice transcription" value={providers.transcription} />
          <Row label="Recording storage" value={providers.storage} />
          <Row label="Model training" value="Never. Your memoir is not used to train models." />
        </dl>
      </section>

      <DangerZone projectId={project.id} title={project.title} canDelete={access.permissions.has("project:delete")} canExport={access.permissions.has("export")} recordingCount={Number(recordingCount)} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4">
      <dt className="font-medium text-ink">{label}</dt>
      <dd className="text-ink-2 sm:col-span-2">{value}</dd>
    </div>
  );
}
