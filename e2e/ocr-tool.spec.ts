import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tools/ocr-image");
  await expect(page.getByRole("heading", { level: 1, name: "Image OCR" })).toBeVisible();
});

test("rejects non-image files", async ({ page }) => {
  await page.getByLabel("Choose image for OCR").setInputFiles({
    name: "document.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });
  await expect(page.getByRole("status")).toHaveText("Use a PNG, JPG, WEBP or BMP image.");
  await expect(page.getByRole("button", { name: "Extract text" })).toBeDisabled();
});

test("accepts an image and enables extraction", async ({ page }) => {
  await page.getByLabel("Choose image for OCR").setInputFiles({
    name: "scan.png",
    mimeType: "image/png",
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  await expect(page.getByText("scan.png")).toBeVisible();
  await expect(page.getByRole("button", { name: "Extract text" })).toBeEnabled();
});
