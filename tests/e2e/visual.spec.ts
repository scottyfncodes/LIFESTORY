import { expect, test } from "@playwright/test";
import { createProject, signUp } from "./helpers";

/**
 * Responsive sanity pass: every key screen must render without horizontal
 * overflow at the current viewport. Screenshots are kept as artifacts for
 * manual design review.
 */
const dir = process.env.SHOTS_DIR ?? "test-results/shots";

async function noOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(1);
}

test("key screens render without horizontal overflow", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const tag = testInfo.project.name;
  await page.goto("/");
  await noOverflow(page);
  await page.screenshot({ path: `${dir}/${tag}-landing.png`, fullPage: true });
  await page.goto("/sign-up");
  await noOverflow(page);
  await page.screenshot({ path: `${dir}/${tag}-sign-up.png`, fullPage: true });
  await signUp(page);
  await noOverflow(page);
  await page.screenshot({ path: `${dir}/${tag}-onboarding.png`, fullPage: true });
  const projectId = await createProject(page, "The Porch on Elm Street");
  await noOverflow(page);
  await page.screenshot({ path: `${dir}/${tag}-interview.png` });
  await page.getByLabel("Your answer").fill("I was born in Leeds in 1954. My grandmother Edith lived with us on Elm Street, and my father worked at the mill.");
  await page.getByRole("button", { name: "Save answer" }).click();
  await expect(page.locator("p", { hasText: "Edith lived" })).toBeVisible();
  await page.request.get(`/api/projects/${projectId}/jobs`);
  await page.screenshot({ path: `${dir}/${tag}-interview-answered.png` });
  for (const seg of ["", "/timeline", "/people", "/review", "/book", "/settings", "/interview/history"]) {
    await page.goto(`/projects/${projectId}${seg}`);
    await noOverflow(page);
    await page.screenshot({ path: `${dir}/${tag}-project${seg.replace(/\//g, "-") || "-overview"}.png`, fullPage: true });
  }
  await page.goto("/home");
  await noOverflow(page);
  await page.screenshot({ path: `${dir}/${tag}-home.png`, fullPage: true });
  await page.goto("/account");
  await noOverflow(page);
  await page.screenshot({ path: `${dir}/${tag}-account.png`, fullPage: true });
});
