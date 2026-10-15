import { describe, expect, it } from "vitest";
import { createProjectSchema, flattenIssues } from "@/lib/validation/project";

describe("createProjectSchema", () => {
  it("splits topics to avoid on newlines and commas", () => {
    const parsed = createProjectSchema.parse({
      title: " A life ",
      narratorName: "Grace",
      narratorIsUser: "yes",
      intendedScope: "full_life",
      writingStyle: "warm_literary",
      topicsToAvoid: "the divorce\nmy brother, health",
      acknowledgePrivacy: "on",
    });
    expect(parsed.title).toBe("A life");
    expect(parsed.topicsToAvoid).toEqual(["the divorce", "my brother", "health"]);
  });

  it("requires the privacy acknowledgment", () => {
    const result = createProjectSchema.safeParse({
      title: "T",
      narratorName: "N",
      narratorIsUser: "no",
      intendedScope: "childhood",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = flattenIssues(result.error);
      expect(issues.acknowledgePrivacy?.[0]).toMatch(/confirm/i);
    }
  });
});
