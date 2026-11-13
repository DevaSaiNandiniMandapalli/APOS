import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PDFDocument } from "@cantoo/pdf-lib";

test("server tools page explains when no processing server is configured", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/server-tools");
  await expect(page.getByRole("heading", { level: 1, name: "Server tools" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Optional self-hosted processing tools" })).toBeVisible();
  await expect(page.getByText(/processing server is not configured or not reachable/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/browser-local tools elsewhere in APOS never upload/i)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("server tool card uploads files and downloads the validated server response", async ({ page }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  const fixture = Buffer.from(await pdf.save());

  await page.route("**/api/v1/tools", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: "test",
        max_upload_mb: 50,
        max_files: 20,
        processing_server: true,
        tools: [{
          name: "merge",
          label: "Merge PDF",
          description: "Combine PDFs in the order you want.",
          icon: "",
          accepts: ".pdf",
          multiple: true,
          min_files: 2,
          options: [],
          wants_pages: false,
          available: true,
          unavailable_hint: "",
          category: "organize",
          produces_pdf: true,
          interactive: false,
        }],
      }),
    });
  });
  await page.route("**/api/v1/tools/merge", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename*=UTF-8''merged-server.pdf",
      },
      body: fixture,
    });
  });

  await page.goto("/server-tools");
  await page.getByRole("button", { name: /Merge PDF/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Merge PDF" })).toBeVisible();
  await page.getByLabel("Choose files").setInputFiles([
    { name: "first.pdf", mimeType: "application/pdf", buffer: fixture },
    { name: "second.pdf", mimeType: "application/pdf", buffer: fixture },
  ]);
  await expect(page.getByRole("button", { name: "Run Merge PDF" })).toBeEnabled();
  await page.getByRole("button", { name: "Run Merge PDF" }).click();
  const link = page.getByRole("link", { name: /Download merged-server\.pdf/ });
  await expect(link).toBeVisible();
  const event = page.waitForEvent("download");
  await link.click();
  const download = await event;
  expect(download.suggestedFilename()).toBe("merged-server.pdf");
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = await import("node:fs/promises").then(({ readFile }) => readFile(path!));
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
});

test("real FastAPI processing server merges PDFs through the APOS page", async ({ page }) => {
  test.skip(!process.env.APOS_LIVE_BACKEND, "Requires the local FastAPI processing server on port 8000.");
  await page.route("**/api/v1/**", async (route) => {
    const target = route.request().url().replace("http://localhost:3000", "http://127.0.0.1:8000");
    const response = await route.fetch({ url: target });
    await route.fulfill({ response });
  });
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  pdf.addPage([300, 400]);
  const fixture = Buffer.from(await pdf.save());
  await page.goto("/server-tools");
  await page.getByRole("button", { name: /Merge PDF/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Merge PDF" })).toBeVisible();
  await page.getByLabel("Choose files").setInputFiles([
    { name: "server-a.pdf", mimeType: "application/pdf", buffer: fixture },
    { name: "server-b.pdf", mimeType: "application/pdf", buffer: fixture },
  ]);
  await page.getByRole("button", { name: "Run Merge PDF" }).click();
  const link = page.getByRole("link", { name: /Download merged\.pdf/ });
  await expect(link).toBeVisible({ timeout: 30000 });
  const event = page.waitForEvent("download");
  await link.click();
  const download = await event;
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = await import("node:fs/promises").then(({ readFile }) => readFile(path!));
  const output = await PDFDocument.load(bytes);
  expect(output.getPageCount()).toBe(4);
});
