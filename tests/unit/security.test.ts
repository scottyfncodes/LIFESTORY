import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "@/server/api";
import { ForbiddenError, ProviderError, RateLimitError, ValidationError, toErrorPayload } from "@/server/errors";
import { bytesMatchAudioType } from "@/server/upload-sniff";
import { errorCode } from "@/server/logger";

function req(method: string, headers: Record<string, string>): Request {
  return new Request("https://lifestory.example/api/x", { method, headers });
}

describe("same-origin enforcement", () => {
  it("allows same-origin browser requests and plain GETs", () => {
    expect(() => assertSameOrigin(req("GET", { origin: "https://evil.example" }))).not.toThrow();
    expect(() => assertSameOrigin(req("POST", { "sec-fetch-site": "same-origin" }))).not.toThrow();
    expect(() => assertSameOrigin(req("POST", { origin: "https://lifestory.example", host: "lifestory.example" }))).not.toThrow();
    expect(() => assertSameOrigin(req("POST", { origin: "https://lifestory.example", "x-forwarded-host": "lifestory.example", host: "internal" }))).not.toThrow();
  });
  it("rejects cross-site mutations", () => {
    expect(() => assertSameOrigin(req("POST", { origin: "https://evil.example", host: "lifestory.example", "sec-fetch-site": "cross-site" }))).toThrow(ForbiddenError);
    expect(() => assertSameOrigin(req("DELETE", { origin: "null", host: "lifestory.example" }))).toThrow(ForbiddenError);
    expect(() => assertSameOrigin(req("POST", { "sec-fetch-site": "cross-site", host: "lifestory.example" }))).toThrow(ForbiddenError);
  });
});

describe("error payloads never leak internals", () => {
  it("hides unexpected error messages", () => {
    const secretish = new Error("connection to postgresql://user:password@host failed; transcript: my private memory");
    const { status, body } = toErrorPayload(secretish);
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("private memory");
  });
  it("exposes only curated messages for known errors", () => {
    expect(toErrorPayload(new ValidationError("Bad input", { text: ["required"] })).body.error.issues).toEqual({ text: ["required"] });
    expect(toErrorPayload(new RateLimitError(12)).body.error.retryAfter).toBe(12);
    const p = toErrorPayload(new ProviderError("anthropic", "The AI provider is busy.", true));
    expect(p.status).toBe(502);
    expect(p.body.error.message).toBe("The AI provider is busy.");
  });
  it("reduces errors to codes for logs", () => {
    expect(errorCode(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe("ECONNRESET");
    expect(errorCode(new TypeError("boom with secret sk-123"))).toBe("TypeError");
    expect(errorCode("string")).toBe("unknown");
  });
});

describe("upload sniffing", () => {
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(20).fill(0)]);
  const ogg = new Uint8Array([...Buffer.from("OggS"), ...new Array(20).fill(0)]);
  const mp4 = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypM4A "), ...new Array(20).fill(0)]);
  const html = new Uint8Array(Buffer.from("<html><script>alert(1)</script></html>"));
  it("accepts matching containers and rejects mislabeled files", () => {
    expect(bytesMatchAudioType(webm, "audio/webm")).toBe(true);
    expect(bytesMatchAudioType(ogg, "audio/ogg")).toBe(true);
    expect(bytesMatchAudioType(mp4, "audio/mp4")).toBe(true);
    expect(bytesMatchAudioType(html, "audio/webm")).toBe(false);
    expect(bytesMatchAudioType(webm, "audio/mp4")).toBe(false);
    expect(bytesMatchAudioType(new Uint8Array(3), "audio/webm")).toBe(false);
  });
});
