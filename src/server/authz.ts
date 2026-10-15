import { and, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import { memoirProjects, projectMemberships } from "@/db/schema";
import { NotFoundError } from "./errors";

export type Role = "owner" | "interviewer" | "narrator" | "editor" | "viewer";

export type Permission =
  | "project:read"
  | "interview:write"
  | "memory:write"
  | "manuscript:write"
  | "export"
  | "project:manage"
  | "project:delete";

export const ALL_PERMISSIONS: Permission[] = [
  "project:read",
  "interview:write",
  "memory:write",
  "manuscript:write",
  "export",
  "project:manage",
  "project:delete",
];

/**
 * Explicit role grants. Membership rows may narrow (never widen) these via
 * `grantedPermissions`; an empty list means "the role's defaults".
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ALL_PERMISSIONS,
  interviewer: ["project:read", "interview:write", "memory:write", "manuscript:write", "export"],
  narrator: ["project:read", "interview:write", "memory:write", "manuscript:write", "export"],
  editor: ["project:read", "memory:write", "manuscript:write", "export"],
  viewer: ["project:read"],
};

export function permissionsForRole(role: Role, granted: string[] = []): Set<Permission> {
  const defaults = ROLE_PERMISSIONS[role];
  if (role === "owner" || granted.length === 0) return new Set(defaults);
  const allowed = new Set(defaults);
  return new Set(granted.filter((p): p is Permission => allowed.has(p as Permission)));
}

export type ProjectAccess = {
  project: typeof memoirProjects.$inferSelect;
  role: Role;
  permissions: Set<Permission>;
  isOwner: boolean;
};

/**
 * Resolves what `userId` may do on `projectId`. Returns null when the project
 * does not exist, is deleted, or the user has no accepted membership. Callers
 * must treat null as "not found" so project IDs cannot be enumerated.
 */
export async function getProjectAccess(
  db: DbClient,
  userId: string,
  projectId: string,
): Promise<ProjectAccess | null> {
  if (!isUuid(projectId)) return null;
  const project = await db.query.memoirProjects.findFirst({
    where: and(eq(memoirProjects.id, projectId), isNull(memoirProjects.deletedAt)),
  });
  if (!project) return null;
  if (project.ownerUserId === userId) {
    return { project, role: "owner", permissions: permissionsForRole("owner"), isOwner: true };
  }
  const membership = await db.query.projectMemberships.findFirst({
    where: and(
      eq(projectMemberships.projectId, projectId),
      eq(projectMemberships.userId, userId),
      eq(projectMemberships.invitationStatus, "accepted"),
      isNull(projectMemberships.revokedAt),
    ),
  });
  if (!membership) return null;
  const role = membership.role as Role;
  return {
    project,
    role,
    permissions: permissionsForRole(role, membership.grantedPermissions),
    isOwner: false,
  };
}

export async function requireProjectAccess(
  db: DbClient,
  userId: string,
  projectId: string,
  permission: Permission,
): Promise<ProjectAccess> {
  const access = await getProjectAccess(db, userId, projectId);
  if (!access || !access.permissions.has(permission)) {
    // Both "missing" and "forbidden" collapse to not-found on purpose.
    throw new NotFoundError("We couldn't find that memoir project.");
  }
  return access;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
