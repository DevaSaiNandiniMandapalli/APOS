import { expect, test } from "@playwright/test";

test("reveals content as it enters the viewport", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
  await expect(page.locator(".studio-card").first()).toHaveClass(/reveal/);
  await page.locator(".studio-grid").scrollIntoViewIfNeeded();
  await expect(page.locator(".studio-card").first()).toHaveClass(/is-in/);
  const cards = await page.locator(".studio-card.is-in").count();
  expect(cards).toBeGreaterThan(0);
});

test("shows a scroll progress line that grows", async ({ page }) => {
  await page.goto("/");
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--scroll-progress").trim());
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--scroll-progress").trim());
  expect(Number(after)).toBeGreaterThan(Number(before || 0));
});

test("moves the hero art with the pointer", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator(".hero-card");
  const box = (await hero.boundingBox()) as { x: number; y: number; width: number; height: number };
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.waitForTimeout(120);
  const offset = await hero.evaluate((element) => (element as HTMLElement).style.getPropertyValue("--mx"));
  expect(Number(offset)).toBeLessThan(0);
});

test("has a moving capability ticker", async ({ page }) => {
  await page.goto("/");
  const ticker = page.locator(".ticker");
  await expect(ticker).toBeVisible();
  await expect(ticker.locator(".ticker-item").first()).toContainText("tools");
  const animation = await page.locator(".ticker-track").first().evaluate((element) => getComputedStyle(element).animationName);
  expect(animation).toBe("ticker-slide");
});

test("holds still when the visitor asked for reduced motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-motion", "on");
  const opacity = await page.locator(".studio-card").first().evaluate((element) => getComputedStyle(element).opacity);
  expect(Number(opacity)).toBe(1);
  await context.close();
});
