import { expect, test } from "@playwright/test";

test("studio pages have ambience, moving borders and a ready count", async ({ page }) => {
  await page.goto("/studios/ai-studio");
  await expect(page.locator(".ambient i")).toHaveCount(3);
  await expect(page.locator(".route-hero h1")).toHaveText("AI Studio");
  await expect(page.locator(".route-hero-badge")).toContainText("of 4 ready");
  const card = page.locator(".tool-card").first();
  await expect(card).toHaveClass(/moving-border/);
  const animation = await card.evaluate((element) => getComputedStyle(element, "::before").animationName);
  expect(animation).toBe("border-spin");
  await expect(page.locator(".tool-card .tool-icon").first()).toBeVisible();
});

test("tool pages show an animated header, a framed panel and how it works", async ({ page }) => {
  await page.goto("/tools/pdf-to-office");
  await expect(page.locator(".route-hero-icon svg")).toBeVisible();
  await expect(page.locator(".route-hero .status-pill")).toContainText("Available");
  await expect(page.locator(".tool-panel")).toHaveClass(/moving-border/);
  await expect(page.locator(".how-step")).toHaveCount(3);
  await expect(page.locator(".how-step").first()).toContainText("Choose a file");
  const title = await page.locator(".hero-title").evaluate((element) => getComputedStyle(element).animationName);
  expect(title).toBe("title-sheen");
  const ring = await page.locator(".hero-ring").evaluate((element) => getComputedStyle(element).animationName);
  expect(ring).toBe("ring-pulse");
});

test("the header spotlight follows the pointer", async ({ page }) => {
  await page.goto("/tools/merge-pdf");
  const hero = page.locator(".route-hero");
  const box = (await hero.boundingBox()) as { x: number; y: number; width: number; height: number };
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.3);
  await page.waitForTimeout(150);
  const gx = await hero.evaluate((element) => (element as HTMLElement).style.getPropertyValue("--gx"));
  expect(parseFloat(gx)).toBeGreaterThan(50);
});

test("interior pages hold still for reduced motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/tools/merge-pdf");
  const bordered = await page.locator(".tool-panel").evaluate((element) => getComputedStyle(element, "::before").animationName);
  expect(bordered).toBe("none");
  const title = await page.locator(".hero-title").evaluate((element) => getComputedStyle(element).animationName);
  expect(title).toBe("none");
  await context.close();
});
