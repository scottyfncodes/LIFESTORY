import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, isUuid, permissionsForRole } from "@/server/authz";

describe("permissionsForRole", () => {
  it("gives owners everything regardless of narrowing", () => {
    const perms = permissionsForRole("owner", ["project:read"]);
    expect([...perms].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it("viewers can only read", () => {
    const perms = permissionsForRole("viewer");
    expect([...perms]).toEqual(["project:read"]);
  });

  it("granted permissions can narrow but never widen a role", () => {
    const perms = permissionsForRole("editor", ["project:read", "project:delete", "manuscript:write"]);
    expect(perms.has("project:read")).toBe(true);
    expect(perms.has("manuscript:write")).toBe(true);
    expect(perms.has("project:delete")).toBe(false);
  });

  it("narrators and interviewers cannot manage or delete", () => {
    for (const role of ["narrator", "interviewer"] as const) {
      const perms = permissionsForRole(role);
      expect(perms.has("interview:write")).toBe(true);
      expect(perms.has("project:manage")).toBe(false);
      expect(perms.has("project:delete")).toBe(false);
    }
  });
});

describe("isUuid", () => {
  it("accepts v4 uuids and rejects junk", () => {
    expect(isUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301; drop table")).toBe(false);
  });
});
