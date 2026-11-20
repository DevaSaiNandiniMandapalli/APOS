import { expect, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";

test("PDF to Markdown produces a downloadable Markdown document", async ({ page }) => {
  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage([420, 560]);
  first.drawText("Quarterly Report", { x: 32, y: 500, size: 24, font: bold });
  first.drawText("Revenue grew across all regions.", { x: 32, y: 455, size: 12, font: regular });
  const second = pdf.addPage([420, 560]);
  second.drawText("Next steps", { x: 32, y: 500, size: 18, font: bold });
  second.drawText("Review the numbers with finance.", { x: 32, y: 460, size: 12, font: regular });

  await page.goto("/tools/pdf-to-markdown");
  await expect(page.getByRole("heading", { level: 1, name: "PDF to Markdown" })).toBeVisible();
  await page.getByLabel("Choose PDF files").setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: /Convert 1 queued file to Markdown/ }).click();
  await expect(page.getByLabel("Complete")).toHaveCount(1, { timeout: 30000 });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "report.md" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("report.md");
  const path = await download.path();
  expect(path).toBeTruthy();
  const text = await import("node:fs/promises").then(({ readFile }) => readFile(path!, "utf8"));
  expect(text).toContain("# report");
  expect(text).toContain("## Page 1");
  expect(text).toContain("Quarterly Report");
  expect(text).toContain("Revenue grew across all regions.");
  expect(text).toContain("## Page 2");
});
