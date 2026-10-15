import { expect, test } from "@playwright/test";
import { createProject, signUp } from "./helpers";

test("landing page explains the product and offers both pathways", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("A life worth remembering");
  await expect(page.getByRole("link", { name: /Tell my story/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Help someone tell theirs/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});

test("unauthenticated visitors are sent to sign in", async ({ page }) => {
  await page.goto("/home");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fhome/);
});

test("sign up, create a memoir, reopen it, sign out and back in", async ({ page }) => {
  const { email, password } = await signUp(page);
  const projectId = await createProject(page, "The Porch on Elm Street");

  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Continue your story" })).toBeVisible();
  await expect(page.getByText("The Porch on Elm Street").first()).toBeVisible();

  await page.goto(`/projects/${projectId}`);
  await expect(page.getByText("Narrated by Grace")).toBeVisible();

  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByText("The Porch on Elm Street").first()).toBeVisible();
});

test("a project is not visible to another account", async ({ browser, page }) => {
  await signUp(page, "Owner");
  const projectId = await createProject(page, "Private Memoir");

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signUp(otherPage, "Stranger");
  await otherPage.goto(`/projects/${projectId}`);
  await expect(otherPage.getByRole("heading", { name: /couldn.t find that page/ })).toBeVisible();
  await otherPage.goto("/home");
  await expect(otherPage.getByText("Private Memoir")).toHaveCount(0);
  await other.close();
});
