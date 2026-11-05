import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tools/ai-assistant");
  await expect(page.getByRole("heading", { level: 1, name: "AI assistant" })).toBeVisible();
});

test("validates empty input", async ({ page }) => {
  await page.getByRole("button", { name: "Ask Sarvam 105B" }).click();
  await expect(page.locator(".ai__error")).toHaveText("Enter some text first.");
});

test("reports clearly when the server has no AI key", async ({ page }) => {
  await page.getByLabel("Text to send").fill("APOS is a document workspace for everyday office work.");
  await page.locator("#ai-task").selectOption("summarize");
  await page.getByRole("button", { name: "Ask Sarvam 105B" }).click();
  await expect(page.locator(".ai__error")).toContainText("AI is not configured on this server");
});

test("updates the character count", async ({ page }) => {
  await page.getByLabel("Text to send").fill("hello");
  await expect(page.locator(".ai__count")).toHaveText("5 / 12000");
});
