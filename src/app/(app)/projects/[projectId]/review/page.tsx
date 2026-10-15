import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { ReviewList } from "@/components/memory/review-list";
import { getProjectAccess } from "@/server/authz";
import { listReviewItems } from "@/server/memory/service";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Things to confirm" };
export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireUser();
  const db = await getDb();
  const access = await getProjectAccess(db, user.id, projectId);
  if (!access || !access.permissions.has("memory:write")) notFound();
  const items = await listReviewItems(db, projectId);
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8" style={{ paddingBottom: "calc(2rem + var(--safe-bottom))" }}>
      <h1 className="font-serif text-[1.9rem] leading-tight text-ink">Things to confirm</h1>
      <p className="mt-1 text-[0.95rem] leading-relaxed text-ink-2">Details the note-taker wasn&rsquo;t sure about, or that seem to disagree with something said earlier. Your answers are never changed; this only affects the timeline, people and future drafts.</p>
      <div className="mt-6"><ReviewList projectId={projectId} items={items.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() }))} /></div>
    </div>
  );
}
