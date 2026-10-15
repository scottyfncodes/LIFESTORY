import { expect, test, type APIRequestContext } from "@playwright/test";
import { createProject, signUp } from "./helpers";

async function ownerSetup(page: Parameters<typeof signUp>[0]) {
  await signUp(page, "Owner");
  const projectId = await createProject(page, "Locked Memoir");
  await page.waitForURL(/interview\/[0-9a-f-]+/);
  const sessionId = page.url().match(/interview\/([0-9a-f-]+)/)![1];
  await page.getByLabel("Your answer").fill("A private answer about my family.");
  await page.getByRole("button", { name: "Save answer" }).click();
  await expect(page.locator("p", { hasText: "A private answer" })).toBeVisible();
  const chapters = await page.request.post(`/api/projects/${projectId}/chapters`, { data: { action: "create", title: "Secret chapter" } });
  const { chapter } = await chapters.json();
  return { projectId, sessionId, chapterId: chapter.id as string };
}

test("another signed-in user cannot read, write, export or delete someone else's project through the API", async ({ page, browser }) => {
  const { projectId, sessionId, chapterId } = await ownerSetup(page);
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await signUp(other, "Stranger");
  const api: APIRequestContext = other.request;

  const attempts = [
    api.get(`/api/projects/${projectId}/chapters`),
    api.post(`/api/projects/${projectId}/sessions/${sessionId}/answers`, { data: { text: "intrusion", inputMode: "text", clientTurnId: "stranger-turn-1" } }),
    api.post(`/api/projects/${projectId}/sessions/${sessionId}/skip`, { data: { clientTurnId: "stranger-skip-1" } }),
    api.post(`/api/projects/${projectId}/sessions`, { data: {} }),
    api.get(`/api/projects/${projectId}/export?format=pdf`),
    api.get(`/api/projects/${projectId}/export?format=json`),
    api.patch(`/api/projects/${projectId}/chapters/${chapterId}`, { data: { action: "edit", body: "vandalised", baseRevisionId: null } }),
    api.delete(`/api/projects/${projectId}/chapters/${chapterId}`),
    api.get(`/api/projects/${projectId}/jobs`),
    api.get(`/api/projects/${projectId}/media/00000000-0000-4000-8000-000000000000`),
  ];
  for (const r of await Promise.all(attempts)) {
    expect(r.status(), `${r.url()} should be hidden`).toBe(404);
  }
  await other.goto(`/projects/${projectId}/book/${chapterId}`);
  await expect(other.getByRole("heading", { name: /couldn.t find that page/ })).toBeVisible();
  await ctx.close();

  // The owner still sees everything intact.
  const mine = await page.request.get(`/api/projects/${projectId}/chapters`);
  expect(mine.ok()).toBe(true);
  const { chapters } = await mine.json();
  expect(chapters.some((c: { title: string }) => c.title === "Secret chapter")).toBe(true);
});

test("unauthenticated and cross-site requests are refused", async ({ page, request }) => {
  const { projectId, sessionId } = await ownerSetup(page);
  const anon = await request.get(`/api/projects/${projectId}/chapters`);
  expect(anon.status()).toBe(401);
  const csrf = await page.request.post(`/api/projects/${projectId}/sessions/${sessionId}/answers`, {
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    data: { text: "forged", inputMode: "text", clientTurnId: "forged-turn-1" },
  });
  expect(csrf.status()).toBe(403);
  const health = await request.get("/api/health");
  const body = await health.json();
  expect(body.database).toBe("ok");
  expect(JSON.stringify(body)).not.toMatch(/secret|key|token/i);
});

test("invalid and oversized uploads are rejected; manipulated ids fail closed", async ({ page }) => {
  const { projectId, sessionId } = await ownerSetup(page);
  const bad = await page.request.post(`/api/projects/${projectId}/sessions/${sessionId}/recordings`, {
    multipart: { file: { name: "evil.webm", mimeType: "audio/webm", buffer: Buffer.from("<html><script>alert(1)</script></html>") } },
  });
  expect(bad.status()).toBe(422);
  const exe = await page.request.post(`/api/projects/${projectId}/sessions/${sessionId}/recordings`, {
    multipart: { file: { name: "evil.exe", mimeType: "application/octet-stream", buffer: Buffer.from([0x4d, 0x5a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) } },
  });
  expect(exe.status()).toBe(422);
  // The e2e server caps uploads at 1 MB (MAX_UPLOAD_MB=1).
  const big = Buffer.alloc(1_200_000, 0);
  big.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  const huge = await page.request.post(`/api/projects/${projectId}/sessions/${sessionId}/recordings`, {
    multipart: { file: { name: "big.webm", mimeType: "audio/webm", buffer: big } },
  });
  expect([413, 422]).toContain(huge.status());
  const manipulated = await page.request.get(`/api/projects/not-a-uuid/chapters`);
  expect(manipulated.status()).toBe(404);
  const sqlish = await page.request.get(`/api/projects/${projectId}'; drop table users;--/chapters`);
  expect([404, 400]).toContain(sqlish.status());
});

test("deleting a project removes access immediately and purges its records", async ({ page }) => {
  const { projectId, sessionId } = await ownerSetup(page);
  await page.goto(`/projects/${projectId}/settings`);
  await page.getByRole("button", { name: /Delete this memoir/ }).click();
  await page.getByLabel(/Type "Locked Memoir" to confirm/).fill("Locked Memoir");
  await page.getByRole("button", { name: "Permanently delete" }).click();
  await expect(page).toHaveURL(/\/home\?deleted=1/);
  await expect(page.getByText("The memoir has been deleted.")).toBeVisible();
  const gone = await page.request.get(`/api/projects/${projectId}/chapters`);
  expect(gone.status()).toBe(404);
  const answers = await page.request.post(`/api/projects/${projectId}/sessions/${sessionId}/answers`, { data: { text: "late", inputMode: "text", clientTurnId: "late-after-delete-1" } });
  expect(answers.status()).toBe(404);
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByRole("heading", { name: /couldn.t find that page/ })).toBeVisible();
});
