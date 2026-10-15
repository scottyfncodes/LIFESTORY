import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { ProjectNav } from "@/components/app/project-nav";
import { Badge } from "@/components/ui/badge";
import { getProjectAccess } from "@/server/authz";
import { requireUser } from "@/server/session";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await requireUser(`/projects/${projectId}`);
  const db = await getDb();
  const access = await getProjectAccess(db, user.id, projectId);
  if (!access) notFound();
  const { project } = access;

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col">
      <div className="border-b border-line/70 bg-paper">
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="truncate font-serif text-[1.35rem] leading-tight text-ink sm:text-[1.6rem]">{project.title}</h2>
            <Badge tone={project.projectType === "hosted" ? "ochre" : "clay"}>
              {project.projectType === "hosted" ? "Together" : "My life"}
            </Badge>
          </div>
          <p className="mt-0.5 text-[0.875rem] text-ink-3">Narrated by {project.narratorName}</p>
          <div className="mt-3">
            <ProjectNav projectId={project.id} />
          </div>
        </div>
      </div>
      <div className="flex-1 pb-20 sm:pb-0">{children}</div>
    </div>
  );
}
