import { apiHandler } from "@/server/api";
import { requireProjectAccess } from "@/server/authz";
import { AppError, ValidationError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { buildBookModel, safeFilename } from "@/server/export/manuscript";
import { renderBookDocx } from "@/server/export/docx";
import { renderBookPdf } from "@/server/export/pdf";
import { getManuscript } from "@/server/manuscript/service";
import { recordAudit } from "@/server/audit";
import { log } from "@/server/logger";

export const maxDuration = 120;

export const GET = apiHandler<{ projectId: string }>(async ({ db, user, request }, { projectId }) => {
  await requireProjectAccess(db, user.id, projectId, "export");
  await enforceRateLimit(db, "export", user.id);
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "pdf" && format !== "docx") throw new ValidationError("Choose PDF or Word format.");
  const { project, chapters } = await getManuscript(db, projectId);
  const book = buildBookModel({ title: project.title, narratorName: project.narratorName, chapters: chapters.map((c) => ({ title: c.title, subtitle: c.subtitle, body: c.body, flags: c.flags })) });
  if (book.chapters.length === 0) throw new AppError("empty_manuscript", "There are no drafted chapters to export yet.", 409);
  const started = Date.now();
  const bytes = format === "pdf" ? await renderBookPdf(book) : await renderBookDocx(book);
  await recordAudit(db, { projectId, actorUserId: user.id, actionType: `export.${format}`, targetType: "memoir_project", targetId: projectId });
  log.info("export.generated", { projectId, format, bytes: bytes.length, chapters: book.chapters.length, durationMs: Date.now() - started });
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${safeFilename(project.title, format)}"`,
      "content-length": String(bytes.length),
      "cache-control": "private, no-store",
    },
  });
});
