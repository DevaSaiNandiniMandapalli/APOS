import { expect, test } from "@playwright/test";
import { PDFDocument } from "@cantoo/pdf-lib";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);

async function makePdf(pages: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) pdf.addPage([595, 842]);
  return Buffer.from(await pdf.save());
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tools/file-inspector");
  await expect(page.getByRole("heading", { level: 1, name: "File inspector" })).toBeVisible();
});

test("inspects an image and reports checksum and dimensions", async ({ page }) => {
  await page.getByLabel("Choose a file to inspect").setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: PNG_1X1,
  });

  const grid = page.getByLabel("File properties");
  await expect(grid).toBeVisible();
  await expect(grid.locator('[data-field="file-name"]')).toHaveText("pixel.png");
  await expect(grid.locator('[data-field="file-type"]')).toHaveText("PNG image");
  await expect(grid.locator('[data-field="dimensions"]')).toHaveText("1 × 1 px (ratio 1)");
  await expect(grid.locator('[data-field="sha-256"]')).toHaveText(/^[0-9A-F]{8}( [0-9A-F]{8}){7}$/);
});

test("reports the page count of a PDF", async ({ page }) => {
  await page.getByLabel("Choose a file to inspect").setInputFiles({
    name: "three-pages.pdf",
    mimeType: "application/pdf",
    buffer: await makePdf(3),
  });

  const grid = page.getByLabel("File properties");
  await expect(grid.locator('[data-field="file-type"]')).toHaveText("PDF document");
  await expect(grid.locator('[data-field="pages"]')).toHaveText("3");
});

test("counts lines and words in a text file", async ({ page }) => {
  await page.getByLabel("Choose a file to inspect").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("alpha beta\ngamma delta\n"),
  });

  const grid = page.getByLabel("File properties");
  await expect(grid.locator('[data-field="text-content"]')).toHaveText("3 lines · 4 words");
});

test("rejects an empty file with a clear message", async ({ page }) => {
  await page.getByLabel("Choose a file to inspect").setInputFiles({
    name: "empty.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(0),
  });
  await expect(page.locator(".merge-error")).toContainText("empty");
});
