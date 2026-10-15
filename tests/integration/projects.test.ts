import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db";
import { createTestUser, setupTestDb, teardownTestDb } from "../helpers/db";
import { createProject, getProjectForUser, listProjectsForUser, updateProjectSettings } from "@/server/projects";
import { getProjectAccess, requireProjectAccess } from "@/server/authz";
import { NotFoundError, RateLimitError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { projectMemberships } from "@/db/schema";

let db: Database;
let alice: { id: string };
let bob: { id: string };

beforeAll(async () => {
  db = await setupTestDb();
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");
});

afterAll(teardownTestDb);

const baseInput = {
  title: "Alice's Story",
  narratorName: "Alice",
  narratorIsUser: "yes" as const,
  intendedScope: "full_life" as const,
  scopeDescription: "",
  writingStyle: "warm_literary" as const,
  topicsToAvoid: [] as string[],
  acknowledgePrivacy: "on" as const,
};

describe("memoir projects", () => {
  it("creates a private project the owner can reopen", async () => {
    const { id } = await createProject(db, alice.id, baseInput);
    const access = await getProjectForUser(db, alice.id, id);
    expect(access.isOwner).toBe(true);
    expect(access.project.narratorUserId).toBe(alice.id);
    expect(access.project.projectType).toBe("self_guided");

    const list = await listProjectsForUser(db, alice.id);
    expect(list.map((p) => p.id)).toContain(id);
  });

  it("hosted projects do not bind the narrator to the creator's account", async () => {
    const { id } = await createProject(db, alice.id, { ...baseInput, narratorIsUser: "no", narratorName: "Dad" });
    const access = await getProjectForUser(db, alice.id, id);
    expect(access.project.projectType).toBe("hosted");
    expect(access.project.narratorUserId).toBeNull();
  });

  it("another user cannot read, list, or manage the project", async () => {
    const { id } = await createProject(db, alice.id, baseInput);
    expect(await getProjectAccess(db, bob.id, id)).toBeNull();
    await expect(requireProjectAccess(db, bob.id, id, "project:read")).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateProjectSettings(db, bob.id, id, {
        title: "Hijacked",
        narratorName: "X",
        intendedScope: "full_life",
        scopeDescription: "",
        writingStyle: "lively",
        topicsToAvoid: [],
        retainAudioDays: "30",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const bobList = await listProjectsForUser(db, bob.id);
    expect(bobList.map((p) => p.id)).not.toContain(id);
    const after = await getProjectForUser(db, alice.id, id);
    expect(after.project.title).toBe("Alice's Story");
  });

  it("manipulated project ids fail closed", async () => {
    expect(await getProjectAccess(db, alice.id, "not-a-uuid")).toBeNull();
    expect(await getProjectAccess(db, alice.id, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("revoked memberships lose access while accepted ones keep role limits", async () => {
    const { id } = await createProject(db, alice.id, baseInput);
    await db.insert(projectMemberships).values({ projectId: id, userId: bob.id, role: "viewer", invitationStatus: "accepted" });
    const viewer = await getProjectAccess(db, bob.id, id);
    expect(viewer?.role).toBe("viewer");
    expect(viewer?.permissions.has("interview:write")).toBe(false);
    await expect(requireProjectAccess(db, bob.id, id, "export")).rejects.toBeInstanceOf(NotFoundError);

    await db.update(projectMemberships).set({ revokedAt: new Date() });
    expect(await getProjectAccess(db, bob.id, id)).toBeNull();
  });

  it("the owner can update settings and the change persists", async () => {
    const { id } = await createProject(db, alice.id, baseInput);
    await updateProjectSettings(db, alice.id, id, {
      title: "Renamed",
      narratorName: "Alice M.",
      intendedScope: "childhood",
      scopeDescription: "The Leeds years",
      writingStyle: "reflective",
      topicsToAvoid: ["politics"],
      retainAudioDays: "keep",
    });
    const access = await getProjectForUser(db, alice.id, id);
    expect(access.project.title).toBe("Renamed");
    expect(access.project.topicsToAvoid).toEqual(["politics"]);
    expect(access.project.privacySettings.retainAudioDays).toBeNull();
  });
});

describe("rate limiting", () => {
  it("rejects once the window limit is exceeded", async () => {
    process.env.RATE_LIMITS_DISABLED = "0";
    try {
      const rule = { limit: 3, windowSeconds: 60 };
      for (let i = 0; i < 3; i += 1) {
        await enforceRateLimit(db, "answer", "subject-a", rule);
      }
      await expect(enforceRateLimit(db, "answer", "subject-a", rule)).rejects.toBeInstanceOf(RateLimitError);
      await expect(enforceRateLimit(db, "answer", "subject-b", rule)).resolves.toBeUndefined();
    } finally {
      process.env.RATE_LIMITS_DISABLED = "1";
    }
  });
});
