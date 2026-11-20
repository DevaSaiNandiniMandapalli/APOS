import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";

async function makePdf(text = "Regression fixture") {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([320, 420]).drawText(text, { x: 30, y: 350, size: 14, font });
  return Buffer.from(await pdf.save());
}

test("PDF to Text marks an empty custom page range as failed instead of wedging the batch", async ({ page }) => {
  await page.goto("/tools/pdf-to-text");
  await page.getByLabel("Choose PDF files").setInputFiles({
    name: "regression.pdf",
    mimeType: "application/pdf",
    buffer: await makePdf(),
  });
  await expect(page.getByText(/detected PDF/)).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Pages for regression.pdf").selectOption("custom");
  await page.getByRole("button", { name: /Convert 1 queued file to text/ }).click();
  await expect(page.getByLabel("Failed")).toHaveCount(1, { timeout: 15000 });
  await expect(page.getByText(/Enter a page range for this file/)).toBeVisible();
  await expect(page.getByText(/batch could not be scheduled/i)).toHaveCount(0);
});

test("Document summary can ask a follow-up about a long document", async ({ page }) => {
  await page.route("**/api/ai", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ answer: "Mock answer for a long document." }),
    });
  });
  await page.goto("/tools/document-summary");
  await page.getByLabel("Choose a document").setInputFiles({
    name: "long.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("A".repeat(20000)),
  });
  await expect(page.getByText(/20,000 characters extracted/)).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Ask about this document").fill("What is this document?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Mock answer for a long document.")).toBeVisible();
  await expect(page.getByText(/Text is too long/)).toHaveCount(0);
});

test("Presentation Editor has no horizontal overflow at 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/presentation-editor");
  await expect(page.getByRole("heading", { level: 1, name: "Presentation Editor" })).toBeVisible();
  const metrics = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.inner + 1);
});

test("Unlock PDF removes encryption and reports whether text was preserved", async ({ page }) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([320, 420]).drawText("KEEP THIS TEXT", { x: 30, y: 350, size: 14, font });
  pdf.encrypt({ userPassword: "userpass123", ownerPassword: "ownerpass123", algorithm: "AES-256" });
  await page.goto("/tools/unlock-pdf");
  await page.getByLabel("Choose a locked PDF").setInputFiles({
    name: "locked.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await page.locator("#unlock-password").fill("userpass123");
  await page.getByRole("button", { name: "Unlock PDF" }).click();
  await expect(page.getByText(/text layer preserved/i)).toBeVisible({ timeout: 30000 });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download unlocked PDF" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = await import("node:fs/promises").then(({ readFile }) => readFile(path!));
  const unlocked = await PDFDocument.load(bytes);
  expect(unlocked.isEncrypted).toBe(false);
  expect(unlocked.getPageCount()).toBe(1);
});

test("AI tool copy discloses the AI text path instead of claiming nothing leaves the device", async ({ page }) => {
  await page.goto("/tools/document-summary");
  await expect(page.getByText(/only the text you choose to process/i).first()).toBeVisible();
  await expect(page.getByText(/runs inside your browser, so the document never leaves your device/i)).toHaveCount(0);
});

test("the previously flagged tool pages have no axe violations", async ({ page }) => {
  for (const id of ["document-editor", "spreadsheet-editor", "workflow-builder", "verify-compare"]) {
    await page.goto(`/tools/${id}`);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, `${id} axe violations`).toEqual([]);
  }
});
