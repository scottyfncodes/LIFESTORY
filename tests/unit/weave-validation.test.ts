import { describe, expect, it } from "vitest";
import { createWeaveSchema, reserveRecordingSchema, resolveWeaveAudioType, updateRecordingSchema } from "@/lib/validation/weave";
import { MAX_RANGE_CHUNK, parseRange } from "@/server/http-range";

describe("resolveWeaveAudioType", () => {
  it("accepts allow-listed types and aliases", () => {
    expect(resolveWeaveAudioType("audio/x-m4a", "a.m4a")).toBe("audio/x-m4a");
    expect(resolveWeaveAudioType("audio/mp3", "a.mp3")).toBe("audio/mpeg");
    expect(resolveWeaveAudioType("audio/webm;codecs=opus", "a.webm")).toBe("audio/webm");
  });
  it("falls back to the extension only when the browser gives no real type (iOS)", () => {
    expect(resolveWeaveAudioType("", "Voice Memo.m4a")).toBe("audio/mp4");
    expect(resolveWeaveAudioType("application/octet-stream", "talk.WAV")).toBe("audio/wav");
  });
  it("rejects non-audio types even with an audio extension", () => {
    expect(resolveWeaveAudioType("text/html", "evil.m4a")).toBeNull();
    expect(resolveWeaveAudioType("video/mp4", "clip.mp4")).toBeNull();
    expect(resolveWeaveAudioType("", "notes.pdf")).toBeNull();
    expect(resolveWeaveAudioType("audio/flac", "song.flac")).toBeNull();
  });
});

describe("weave schemas", () => {
  const base = { title: "Farm years", participants: [{ displayName: "Me", isAccountHolder: true }, { displayName: "June" }], participantConsent: true };
  it("requires explicit participant consent", () => {
    expect(createWeaveSchema.safeParse(base).success).toBe(true);
    expect(createWeaveSchema.safeParse({ ...base, participantConsent: false }).success).toBe(false);
    expect(createWeaveSchema.safeParse({ ...base, participantConsent: undefined }).success).toBe(false);
  });
  it("needs 2 to 6 participants with at most one account holder", () => {
    expect(createWeaveSchema.safeParse({ ...base, participants: [{ displayName: "Me" }] }).success).toBe(false);
    expect(createWeaveSchema.safeParse({ ...base, participants: Array.from({ length: 7 }, (_, i) => ({ displayName: `P${i}` })) }).success).toBe(false);
    expect(createWeaveSchema.safeParse({ ...base, participants: [{ displayName: "A", isAccountHolder: true }, { displayName: "B", isAccountHolder: true }] }).success).toBe(false);
  });
  it("validates upload reservations", () => {
    const ok = { clientUploadId: "abc12345-xyz", filename: "a.m4a", mimeType: "audio/mp4", size: 10 };
    expect(reserveRecordingSchema.safeParse(ok).success).toBe(true);
    expect(reserveRecordingSchema.safeParse({ ...ok, size: 0 }).success).toBe(false);
    expect(reserveRecordingSchema.safeParse({ ...ok, clientUploadId: "../../etc" }).success).toBe(false);
    expect(reserveRecordingSchema.safeParse({ ...ok, size: 1.5 }).success).toBe(false);
  });
  it("validates recording details", () => {
    expect(updateRecordingSchema.safeParse({ recordedOn: "1987-07-04", recordedOnPrecision: "month" }).success).toBe(true);
    expect(updateRecordingSchema.safeParse({ recordedOn: "July 1987" }).success).toBe(false);
    expect(updateRecordingSchema.safeParse({ recordedOnPrecision: "decade" }).success).toBe(false);
  });
});

describe("parseRange", () => {
  it("handles the ranges media elements send", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=0-1000", 100)).toEqual({ start: 0, end: 99 });
  });
  it("caps open-ended ranges", () => {
    expect(parseRange("bytes=0-", MAX_RANGE_CHUNK * 3)).toEqual({ start: 0, end: MAX_RANGE_CHUNK - 1 });
  });
  it("rejects unsatisfiable or malformed ranges", () => {
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=5-2", 100)).toBe("invalid");
    expect(parseRange("bytes=-0", 100)).toBe("invalid");
    expect(parseRange("bytes=0-1,5-6", 100)).toBe("invalid");
    expect(parseRange("items=0-1", 100)).toBe("invalid");
  });
});
