import { expect, type Page } from "@playwright/test";

export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

export async function signUp(page: Page, name = "Grace Example"): Promise<{ email: string; password: string }> {
  const email = uniqueEmail();
  const password = "correct-horse-battery-staple";
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/projects\/new/);
  return { email, password };
}

export async function createProject(page: Page, title = "A Working Title"): Promise<string> {
  if (!page.url().includes("/projects/new")) await page.goto("/projects/new");
  await page.getByLabel("Working title").fill(title);
  await page.getByLabel("Narrator's preferred name").fill("Grace");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Start the first conversation" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/interview/);
  const match = page.url().match(/\/projects\/([0-9a-f-]+)\//);
  if (!match) throw new Error("project id not found in url");
  return match[1];
}
