import { expect, test } from "@playwright/test";
import { createProject, signUp } from "./helpers";

/** A real, playable one-second WAV (8 kHz, 8-bit mono silence). */
function wav(seconds = 1): Buffer {
  const rate = 8000;
  const samples = rate * seconds;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples, 40);
  return Buffer.concat([header, Buffer.alloc(samples, 128)]);
}

test("conversation weave: create, upload, reject a spoofed file, play, annotate and delete", async ({ page, browser }) => {
  // Several pages compile on first visit under `next dev` (as in CI).
  test.setTimeout(150_000);
  await signUp(page);
  const projectId = await createProject(page, "Weave Test");

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("link", { name: /Conversations/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/weaves$`), { timeout: 45_000 });
  await expect(page.getByText("No conversations yet")).toBeVisible({ timeout: 45_000 });
  await page.getByRole("link", { name: "Add a conversation" }).click();
  await expect(page.getByLabel("What was this conversation?")).toBeVisible({ timeout: 45_000 });

  await page.getByLabel("What was this conversation?").fill("Farm years with June");
  await page.getByLabel("Person 2").fill("June");
  await page.getByRole("button", { name: "Create conversation" }).click();
  await expect(page.getByText("Please confirm everyone agreed to be recorded.")).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create conversation" }).click();
  // First visit compiles the page under `next dev`; allow for it.
  await expect(page).toHaveURL(/\/weaves\/[0-9a-f-]{36}$/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Farm years with June" })).toBeVisible();
  const weaveId = page.url().split("/").pop()!;

  const audio = wav(1);
  await page.getByTestId("weave-file-input").setInputFiles([
    { name: "kitchen-table.wav", mimeType: "audio/wav", buffer: audio },
    // Claims to be M4A audio but is a web page.
    { name: "not-really-audio.m4a", mimeType: "audio/mp4", buffer: Buffer.from("<!doctype html><script>alert(1)</script>".padEnd(200, " ")) },
  ]);

  const stored = page.getByTestId("recording-card").filter({ hasText: "kitchen-table.wav" });
  await expect(stored).toBeVisible({ timeout: 30_000 });
  await expect(stored).toHaveAttribute("data-status", "uploaded");
  await expect(stored).toContainText("0:01");
  const rejected = page.getByTestId("upload-item").filter({ hasText: "not-really-audio.m4a" });
  await expect(rejected).toContainText("audio type it claims", { timeout: 30_000 });
  await expect(rejected.getByRole("button", { name: "Retry" })).toBeVisible();

  // Authenticated playback supports seeking (Range).
  const src = await stored.locator("audio").getAttribute("src");
  expect(src).toMatch(new RegExp(`^/api/projects/${projectId}/weaves/${weaveId}/recordings/[0-9a-f-]+/audio$`));
  const ranged = await page.request.get(src!, { headers: { range: "bytes=100-199" } });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()["content-range"]).toBe(`bytes 100-199/${audio.length}`);
  expect(ranged.headers()["cache-control"]).toContain("no-store");
  expect((await ranged.body()).length).toBe(100);
  const full = await page.request.get(src!);
  expect(full.status()).toBe(200);
  expect(full.headers()["accept-ranges"]).toBe("bytes");

  // Another account can't reach it.
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  await signUp(strangerPage, "Stranger");
  expect((await strangerPage.request.get(src!)).status()).toBe(404);
  expect((await strangerPage.request.get(`/api/projects/${projectId}/weaves/${weaveId}`)).status()).toBe(404);
  await strangerPage.goto(`/projects/${projectId}/weaves/${weaveId}`);
  await expect(strangerPage.getByText("Farm years with June")).toHaveCount(0);
  await stranger.close();

  // After a reload the rejected upload is shown so it can be removed.
  await page.reload();
  const failedCard = page.getByTestId("recording-card").filter({ hasText: "not-really-audio.m4a" });
  await expect(failedCard).toHaveAttribute("data-status", "failed");
  await failedCard.getByRole("button", { name: "Remove" }).click();
  await failedCard.getByRole("button", { name: "Yes, remove" }).click();
  await expect(failedCard).toHaveCount(0);

  // Date and notes.
  const card = page.getByTestId("recording-card").filter({ hasText: "kitchen-table.wav" });
  await card.getByRole("button", { name: "Date and notes" }).click();
  await card.getByLabel("When was it recorded?").fill("1998-07-04");
  await card.getByLabel("How sure is that date?").selectOption("year");
  await card.getByLabel("Notes about this recording").fill("After the harvest supper.");
  await card.getByRole("button", { name: "Save details" }).click();
  await expect(card).toContainText("recorded 1998");
  await expect(card).toContainText("After the harvest supper.");
  await page.reload();
  await expect(page.getByTestId("recording-card").filter({ hasText: "kitchen-table.wav" })).toContainText("recorded 1998");

  // The list shows it, then deleting removes everything.
  await page.goto(`/projects/${projectId}/weaves`);
  await expect(page.getByText("1 recording")).toBeVisible();
  await page.getByRole("link", { name: /Farm years with June/ }).click();
  await page.getByRole("button", { name: "Delete conversation…" }).click();
  await page.getByRole("button", { name: "Permanently delete" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/weaves$`));
  await expect(page.getByText("No conversations yet")).toBeVisible();
  expect((await page.request.get(src!)).status()).toBe(404);
});

test("conversation weave: a stalled upload stops with Retry, and Retry completes it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Timing-based; one viewport is enough.");
  test.setTimeout(180_000);
  await signUp(page);
  const projectId = await createProject(page, "Weave Stall Test");
  await page.goto(`/projects/${projectId}/weaves/new`);
  await page.getByLabel("What was this conversation?").fill("Stalled upload");
  await page.getByLabel("Person 2").fill("June");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create conversation" }).click();
  await expect(page).toHaveURL(/\/weaves\/[0-9a-f-]{36}$/, { timeout: 45_000 });

  // The storage transfer hangs, as on a phone that loses signal mid-upload.
  let hanging = true;
  await page.route("**/recordings/*/content", async (route) => {
    if (hanging) return; // never answered
    await route.continue();
  });
  await page.getByTestId("weave-file-input").setInputFiles([{ name: "stall.wav", mimeType: "audio/wav", buffer: wav(1) }]);
  const item = page.getByTestId("upload-item").filter({ hasText: "stall.wav" });
  await expect(item).toContainText("Uploading");
  await expect(item).toContainText("connection dropped", { timeout: 90_000 });

  hanging = false;
  await item.getByRole("button", { name: "Retry" }).click();
  const card = page.getByTestId("recording-card").filter({ hasText: "stall.wav" });
  await expect(card).toHaveAttribute("data-status", "uploaded", { timeout: 30_000 });
  const weaveId = page.url().split("/").pop();
  const detail = await (await page.request.get(`/api/projects/${projectId}/weaves/${weaveId}`)).json();
  expect(detail.recordings).toHaveLength(1);
});

test("conversation weave: playback resumes and seeks in place after the storage link expires", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Timing-based; one viewport is enough.");
  test.setTimeout(180_000);
  // The page's clock is controlled so a pause of more than five minutes takes no real time.
  await page.clock.install();
  await signUp(page);
  const projectId = await createProject(page, "Weave Playback Test");
  await page.goto(`/projects/${projectId}/weaves/new`);
  await page.getByLabel("What was this conversation?").fill("Long listen");
  await page.getByLabel("Person 2").fill("June");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create conversation" }).click();
  await expect(page).toHaveURL(/\/weaves\/[0-9a-f-]{36}$/, { timeout: 45_000 });

  // Ten minutes of audio (4.8 MB): more than one 4 MB response, so later
  // positions need another request, as a long recording would on Blob.
  await page.getByTestId("weave-file-input").setInputFiles([{ name: "long.wav", mimeType: "audio/wav", buffer: wav(600) }]);
  const card = page.getByTestId("recording-card").filter({ hasText: "long.wav" });
  await expect(card).toHaveAttribute("data-status", "uploaded", { timeout: 60_000 });
  const audio = card.locator("audio");

  // Storage links stop working once "expired", as presigned Blob links do.
  const expired = new Set<string>();
  const requested: string[] = [];
  let refused = 0;
  await page.route("**/recordings/*/audio*", async (route) => {
    const url = route.request().url();
    requested.push(url);
    if (expired.has(url)) {
      refused += 1;
      return route.fulfill({ status: 403, body: "expired" });
    }
    await route.continue();
  });
  const expireAllLinks = () => requested.forEach((url) => expired.add(url));
  const state = () => audio.evaluate((el: HTMLAudioElement & { probe?: boolean }) => ({ time: el.currentTime, paused: el.paused, same: el.probe === true }));

  await audio.evaluate((el: HTMLAudioElement & { probe?: boolean }) => {
    el.probe = true; // lost if the element is replaced
    return el.play();
  });
  await expect.poll(async () => (await state()).time, { timeout: 15_000 }).toBeGreaterThan(1.5);
  await audio.evaluate((el: HTMLAudioElement) => el.pause());
  const pausedAt = (await state()).time;

  // 1. A pause of more than five minutes, then resume: continues from the same place on a fresh link.
  expireAllLinks();
  await page.clock.fastForward("06:00");
  await audio.evaluate((el: HTMLAudioElement) => el.play().catch(() => {}));
  await expect.poll(async () => (await state()).time, { timeout: 15_000 }).toBeGreaterThan(pausedAt + 0.5);
  let now = await state();
  expect(now.same).toBe(true);
  expect(now.paused).toBe(false);

  // Seeking far ahead (outside the first response) lands there, not back at 0:00.
  await audio.evaluate((el: HTMLAudioElement) => { el.currentTime = 550; });
  await expect.poll(async () => (await state()).time, { timeout: 15_000 }).toBeGreaterThan(550.5);
  expect((await state()).same).toBe(true);
  // The expired link was never used: a fresh one was fetched before it ran out.
  expect(requested.some((url) => url.endsWith("?r=1"))).toBe(true);
  expect(refused).toBe(0);

  // 2. The link stops working without warning: the refused request is replaced and the seek lands.
  await audio.evaluate((el: HTMLAudioElement) => el.pause());
  // A position the browser hasn't buffered, so it has to ask storage again.
  const target = await audio.evaluate((el: HTMLAudioElement) => {
    let end = 0;
    for (let i = 0; i < el.buffered.length; i += 1) {
      if (el.buffered.start(i) - end > 6) break;
      end = el.buffered.end(i);
    }
    return Math.floor(end + 3);
  });
  expect(target).toBeLessThan(590);
  expireAllLinks();
  await audio.evaluate((el: HTMLAudioElement, t: number) => { el.currentTime = t; }, target);
  await expect.poll(() => refused, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(async () => requested.some((url) => url.endsWith("?r=2")), { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => Math.round((await state()).time), { timeout: 15_000 }).toBe(target);
  now = await state();
  expect(now.same).toBe(true);
  expect(now.paused).toBe(true);
  await audio.evaluate((el: HTMLAudioElement) => el.play());
  await expect.poll(async () => (await state()).time, { timeout: 15_000 }).toBeGreaterThan(target + 0.5);
  await expect(card.getByText("couldn’t be loaded")).toHaveCount(0);
});

test("conversation weave: a storage link refused mid-play keeps playing from the same place", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Timing-based; one viewport is enough.");
  test.setTimeout(180_000);
  await signUp(page);
  const projectId = await createProject(page, "Weave Mid-play Test");
  await page.goto(`/projects/${projectId}/weaves/new`);
  await page.getByLabel("What was this conversation?").fill("Mid-play");
  await page.getByLabel("Person 2").fill("June");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create conversation" }).click();
  await expect(page).toHaveURL(/\/weaves\/[0-9a-f-]{36}$/, { timeout: 45_000 });
  await page.getByTestId("weave-file-input").setInputFiles([{ name: "long.wav", mimeType: "audio/wav", buffer: wav(600) }]);
  const card = page.getByTestId("recording-card").filter({ hasText: "long.wav" });
  await expect(card).toHaveAttribute("data-status", "uploaded", { timeout: 60_000 });
  const audio = card.locator("audio");

  // The first link answers once, then is refused, as an expired link would be
  // for a browser that fetches the rest of the file later.
  let firstLinkUses = 0;
  let refused = 0;
  await page.route("**/recordings/*/audio*", async (route) => {
    if (!route.request().url().includes("?r=")) {
      firstLinkUses += 1;
      if (firstLinkUses > 1) {
        refused += 1;
        return route.fulfill({ status: 403, body: "expired" });
      }
    }
    await route.continue();
  });
  const state = () => audio.evaluate((el: HTMLAudioElement & { probe?: boolean }) => ({ time: el.currentTime, paused: el.paused, same: el.probe === true }));
  await audio.evaluate((el: HTMLAudioElement & { probe?: boolean }) => {
    el.probe = true;
    return el.play();
  });
  await expect.poll(async () => (await state()).time, { timeout: 15_000 }).toBeGreaterThan(1);
  // Past the first 4 MB response, while playing.
  await audio.evaluate((el: HTMLAudioElement) => { el.currentTime = 560; });
  await expect.poll(() => refused, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await state()).time, { timeout: 15_000 }).toBeGreaterThan(561);
  const now = await state();
  expect(now.same).toBe(true);
  expect(now.paused).toBe(false);
});
