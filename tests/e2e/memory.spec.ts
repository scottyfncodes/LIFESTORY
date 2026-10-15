import { expect, test } from "@playwright/test";
import { createProject, signUp } from "./helpers";

test("answers become timeline events, people and review items that can be corrected", async ({ page }) => {
  await signUp(page);
  const projectId = await createProject(page, "Memory Test");

  await page.getByLabel("Your answer").fill("I was born in Leeds in 1954. My grandmother Edith lived with us. I think we moved in 1961, but I'm not sure.");
  await page.getByRole("button", { name: "Save answer" }).click();
  await expect(page.locator("p", { hasText: "Edith lived with us" })).toBeVisible();

  // Drain background processing deterministically.
  const drained = await page.request.get(`/api/projects/${projectId}/jobs`);
  expect(drained.ok()).toBe(true);
  await page.request.get(`/api/projects/${projectId}/jobs`);

  await page.goto(`/projects/${projectId}/people`);
  await expect(page.getByRole("link", { name: /Edith/ })).toBeVisible();
  await page.getByRole("link", { name: /Edith/ }).click();
  await expect(page.getByRole("heading", { name: "Edith" })).toBeVisible();
  await page.getByLabel("Full name").fill("Edith Marsh");
  await page.getByRole("button", { name: "Save person" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.goto(`/projects/${projectId}/timeline`);
  await expect(page.getByRole("heading", { name: "1950s" })).toBeVisible();
  await expect(page.getByText("approximate").first()).toBeVisible();

  await page.getByRole("button", { name: "Edit event" }).first().click();
  await page.getByLabel("Place").first().fill("Leeds, Yorkshire");
  await page.getByRole("button", { name: "Save event" }).first().click();
  await expect(page.getByText("Leeds, Yorkshire")).toBeVisible();
  await expect(page.getByText("checked by you").first()).toBeVisible();

  await page.goto(`/projects/${projectId}/review`);
  await expect(page.getByText("Uncertain detail").first()).toBeVisible();
  await page.getByRole("button", { name: "That's right" }).first().click();
  await expect(page.getByText("Uncertain detail")).toHaveCount(0);
});
