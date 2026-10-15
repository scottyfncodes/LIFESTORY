import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { getDb } from "@/db";
import { getProjectAccess } from "@/server/authz";
import { getManuscript, splitParagraphs } from "@/server/manuscript/service";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Read the book" };
export const dynamic = "force-dynamic";

export default async function BookPreviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireUser();
  const db = await getDb();
  const access = await getProjectAccess(db, user.id, projectId);
  if (!access) notFound();
  const { project, chapters } = await getManuscript(db, projectId);
  const drafted = chapters.filter((c) => c.body.trim());
  const canExport = access.permissions.has("export");
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10" style={{ paddingBottom: "calc(3rem + var(--safe-bottom))" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/projects/${projectId}/book`} className="inline-flex items-center gap-1.5 text-[0.9rem] text-ink-2 hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden /> Chapters</Link>
        {canExport && drafted.length > 0 ? (
          <div className="flex gap-2">
            <a href={`/api/projects/${projectId}/export?format=pdf`} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] border border-line bg-white px-3 text-[0.9rem] font-medium text-ink hover:bg-paper-2"><Download className="h-4 w-4" aria-hidden /> Download PDF</a>
            <a href={`/api/projects/${projectId}/export?format=docx`} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] border border-line bg-white px-3 text-[0.9rem] font-medium text-ink hover:bg-paper-2"><Download className="h-4 w-4" aria-hidden /> Download Word</a>
          </div>
        ) : null}
      </div>
      <div className="mt-8 rounded-[var(--radius-lg)] border border-line bg-white px-6 py-12 shadow-[var(--shadow-soft)] sm:px-14 sm:py-16">
        <header className="text-center">
          <h1 className="font-serif text-[2.4rem] leading-tight text-ink sm:text-[3rem]">{project.title}</h1>
          <p className="mt-3 font-serif text-[1.15rem] italic text-ink-2">by {project.narratorName}</p>
        </header>
        {drafted.length === 0 ? (
          <p className="mt-12 text-center text-[1rem] text-ink-2">No chapters have been drafted yet.</p>
        ) : (
          <>
            {drafted.length > 1 ? (
              <nav className="mt-14" aria-label="Contents">
                <h2 className="font-serif text-[1.3rem] text-ink">Contents</h2>
                <ol className="mt-3 space-y-1.5 font-serif text-[1.05rem] text-ink-2">
                  {drafted.map((c, i) => <li key={c.id}><a href={`#chapter-${i + 1}`} className="hover:text-clay-2">{i + 1}. {c.title}</a></li>)}
                </ol>
              </nav>
            ) : null}
            {drafted.map((c, i) => (
              <section key={c.id} id={`chapter-${i + 1}`} className="mt-16 break-before-page">
                <p className="text-center text-[0.75rem] font-medium uppercase tracking-[0.2em] text-ink-3">Chapter {i + 1}</p>
                <h2 className="mt-2 text-center font-serif text-[1.9rem] leading-tight text-ink">{c.title}</h2>
                {c.subtitle ? <p className="mt-1 text-center font-serif italic text-ink-2">{c.subtitle}</p> : null}
                <div className="mt-8">
                  {splitParagraphs(c.body).map((p, j) => <p key={j} className="prose-book">{p}</p>)}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
      <p className="mt-6 text-center text-[0.85rem] text-ink-3 print:hidden">Drafted passages come from your answers and may still need your eye. Review before sharing.</p>
    </div>
  );
}
