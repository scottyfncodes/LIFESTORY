import { expect, test } from "@playwright/test";
import { createProject, signUp } from "./helpers";

test("chapters are proposed, drafted, edited, restored and exported", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page);
  const projectId = await createProject(page, "Book Test");
  const answers = [
    "I was born in Leeds in 1954, the youngest of three.",
    "My grandmother Edith lived with us and baked bread on Sundays.",
    "My first job was at the mill, sweeping floors for a man called Harold.",
  ];
  for (const a of answers) {
    await page.getByLabel("Your answer").fill(a);
    await page.getByRole("button", { name: "Save answer" }).click();
    await expect(page.locator("p", { hasText: a.slice(0, 30) })).toBeVisible();
  }

  await page.goto(`/projects/${projectId}/book`);
  await page.getByRole("button", { name: "Propose chapters" }).click();
  await expect(page.getByText(/Proposed \d+ new chapter/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: /Chapter 1/ }).first().click();

  await page.getByRole("button", { name: "Draft this chapter" }).click();
  await expect(page.locator("p.prose-book").first()).toBeVisible({ timeout: 30_000 });
  const originalFirst = await page.locator("p.prose-book").first().innerText();

  await page.getByRole("button", { name: "Edit text" }).click();
  await page.getByLabel("Chapter text").fill(`${originalFirst}\n\nA paragraph I wrote myself.`);
  await page.getByRole("button", { name: "Save as new revision" }).click();
  await expect(page.locator("p.prose-book", { hasText: "A paragraph I wrote myself." })).toBeVisible();

  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText("Revision 2", { exact: true })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Restore" }).first().click();
  await expect(page.getByText("Revision restored.")).toBeVisible();
  await expect(page.locator("p.prose-book", { hasText: "A paragraph I wrote myself." })).toHaveCount(0);

  await page.goto(`/projects/${projectId}/book/preview`);
  await expect(page.getByRole("heading", { level: 1, name: "Book Test" })).toBeVisible();

  const pdf = await page.request.get(`/api/projects/${projectId}/export?format=pdf`);
  expect(pdf.ok()).toBe(true);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  const docx = await page.request.get(`/api/projects/${projectId}/export?format=docx`);
  expect(docx.ok()).toBe(true);
  expect((await docx.body()).subarray(0, 2).toString()).toBe("PK");
});
