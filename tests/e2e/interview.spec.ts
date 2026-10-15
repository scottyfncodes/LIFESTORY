import { expect, test } from "@playwright/test";
import { createProject, signUp } from "./helpers";

test.use({
  launchOptions: {
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
  permissions: ["microphone"],
});

test("typed interview: answer, follow-up, reload, skip, pause and resume", async ({ page }) => {
  await signUp(page);
  const projectId = await createProject(page, "Interview Test");
  await expect(page.getByText("Current question")).toBeVisible();
  const opening = await page.locator("p.font-serif").last().innerText();
  expect(opening).toContain("Grace");

  await page.getByLabel("Your answer").fill("I was born in Leeds in 1954. My grandmother Edith lived with us on Elm Street.");
  await page.getByRole("button", { name: "Save answer" }).click();
  await expect(page.locator("p", { hasText: "Edith lived with us" })).toBeVisible();
  await expect(page.getByText("Current question")).toBeVisible();
  const followUp = await page.locator("p.font-serif").last().innerText();
  expect(followUp).not.toBe(opening);

  await page.reload();
  await expect(page.locator("p", { hasText: "Edith lived with us" })).toBeVisible();
  await expect(page.locator("p.font-serif").last()).toHaveText(followUp);

  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("Skipped this question.")).toBeVisible();
  const afterSkip = await page.locator("p.font-serif").last().innerText();
  expect(afterSkip).not.toBe(followUp);

  await page.getByRole("button", { name: "Session options" }).click();
  await page.getByRole("menuitem", { name: "Pause for now" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
  await page.getByRole("link", { name: /Continue the conversation/ }).click();
  await expect(page.locator("p", { hasText: "Edith lived with us" })).toBeVisible();
  await expect(page.locator("p.font-serif").last()).toHaveText(afterSkip);
});

test("voice answer: record, review the transcript, correct it, keep it, and play it back", async ({ page }) => {
  await signUp(page);
  const projectId = await createProject(page, "Voice Test");
  await page.getByRole("button", { name: "Record an answer" }).click();
  await expect(page.getByText(/Recording \d:\d\d/)).toBeVisible();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Stop" }).click();
  const transcript = page.getByLabel("Transcript of your recording");
  await expect(transcript).toHaveValue(/fixture transcript/);
  await transcript.fill("This is a corrected transcript about my aunt Mabel.");
  await page.getByRole("button", { name: "Keep this answer" }).click();
  await expect(page.locator("p", { hasText: "This is a corrected transcript about my aunt Mabel." })).toBeVisible();
  await expect(page.getByText(/Spoken · corrected/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Play recording" })).toBeVisible();

  const mediaUrl = await page.evaluate(() => {
    const el = document.querySelector("button[aria-label='Play recording']");
    return el ? "found" : "missing";
  });
  expect(mediaUrl).toBe("found");

  // The recording is only served to authenticated project members.
  const response = await page.request.get(`/api/projects/${projectId}/jobs`);
  expect(response.ok()).toBe(true);

  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.getByLabel("Correct your answer").fill("This is a corrected transcript about my aunt Mabel from Hull.");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.locator("p", { hasText: "aunt Mabel from Hull" })).toBeVisible();
});

test("a draft typed answer survives a reload before it is saved", async ({ page }) => {
  await signUp(page);
  await createProject(page, "Draft Test");
  await page.getByLabel("Your answer").fill("Half-written thought about the allotment");
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByLabel("Your answer")).toHaveValue("Half-written thought about the allotment");
});
