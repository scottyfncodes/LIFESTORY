import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getProjectAccess } from "@/server/authz";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireUser();
  const db = await getDb();
  const access = await getProjectAccess(db, user.id, projectId);
  if (!access) notFound();
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="font-serif text-[1.9rem] text-ink">People</h1>
      <p className="mt-2 text-ink-2">This section is being built.</p>
    </div>
  );
}
