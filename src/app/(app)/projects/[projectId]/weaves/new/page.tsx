import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/db";
import { CreateWeaveForm } from "@/components/weave/create-weave-form";
import { getProjectAccess } from "@/server/authz";
import { isWeaveEnabled } from "@/server/config";
import { listPeople } from "@/server/memory/service";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "New conversation" };
export const dynamic = "force-dynamic";

export default async function NewWeavePage({ params }: { params: Promise<{ projectId: string }> }) {
  if (!isWeaveEnabled()) notFound();
  const { projectId } = await params;
  const user = await requireUser();
  const db = await getDb();
  const access = await getProjectAccess(db, user.id, projectId);
  if (!access || !access.permissions.has("interview:write")) notFound();
  const persons = await listPeople(db, projectId);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8" style={{ paddingBottom: "calc(2rem + var(--safe-bottom))" }}>
      <Link href={`/projects/${projectId}/weaves`} className="inline-flex items-center gap-1 text-[0.875rem] text-ink-3 hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Conversations
      </Link>
      <h1 className="mt-2 font-serif text-[1.9rem] leading-tight text-ink">Add a conversation</h1>
      <p className="mt-1 text-[0.95rem] leading-relaxed text-ink-2">Start by saying who is talking. You&rsquo;ll add the recordings on the next screen.</p>
      <div className="mt-6">
        <CreateWeaveForm projectId={projectId} accountHolderName={user.name || "Me"} people={persons.map((p) => ({ id: p.id, name: p.preferredName }))} />
      </div>
    </div>
  );
}
