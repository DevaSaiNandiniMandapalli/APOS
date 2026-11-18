import { PDFDocument } from "@cantoo/pdf-lib";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function makePdf(pages: number) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) pdf.addPage([300, 400]);
  return Buffer.from(await pdf.save());
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tools/workflow-builder");
  await expect(page.getByRole("heading", { level: 1, name: "Workflow builder" })).toBeVisible();
});

test("adds, reorders and removes steps", async ({ page }) => {
  await expect(page.getByRole("status")).toContainText("Add at least one step");

  await page.locator("#workflow-step").selectOption("merge");
  await page.getByRole("button", { name: "Add step" }).click();
  await page.locator("#workflow-step").selectOption("compress");
  await page.getByRole("button", { name: "Add step" }).click();

  const labels = page.locator(".workflow__label");
  await expect(labels).toHaveText(["Merge PDFs", "Compress"]);
  await expect(page.getByRole("status")).toContainText("Ready — 2 steps");

  await page.getByRole("button", { name: "Move Compress up" }).click();
  await expect(labels).toHaveText(["Compress", "Merge PDFs"]);

  await page.getByRole("button", { name: "Remove Compress" }).click();
  await expect(labels).toHaveText(["Merge PDFs"]);
});

test("exports the workflow as JSON", async ({ page }) => {
  await page.getByLabel("Name").fill("Daily cleanup");
  await page.locator("#workflow-step").selectOption("compress");
  await page.getByRole("button", { name: "Add step" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("workflow.apos.json");
});

test("runs a merge workflow on real files and downloads the result", async ({ page }) => {
  await page.getByLabel("Name").fill("Merge two files");
  await page.locator("#workflow-step").selectOption("merge");
  await page.getByRole("button", { name: "Add step" }).click();
  await expect(page.getByRole("status")).toContainText("Ready — 1 step");

  await page.getByLabel("Choose workflow input files").setInputFiles([
    { name: "one.pdf", mimeType: "application/pdf", buffer: await makePdf(2) },
    { name: "two.pdf", mimeType: "application/pdf", buffer: await makePdf(1) },
  ]);

  await page.getByRole("button", { name: "Run workflow" }).click();
  const link = page.getByRole("link", { name: /merged\.pdf$/ });
  await expect(link).toBeVisible({ timeout: 30000 });

  const downloadPromise = page.waitForEvent("download");
  await link.click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = await import("node:fs/promises").then(({ readFile }) => readFile(path!));
  const merged = await PDFDocument.load(bytes);
  expect(merged.getPageCount()).toBe(3);
});

test("runs a two-step workflow and reports each step", async ({ page }) => {
  await page.locator("#workflow-step").selectOption("rotate");
  await page.getByRole("button", { name: "Add step" }).click();
  await page.locator("#workflow-step").selectOption("compress");
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Choose workflow input files").setInputFiles({
    name: "one.pdf",
    mimeType: "application/pdf",
    buffer: await makePdf(2),
  });
  await page.getByRole("button", { name: "Run workflow" }).click();
  const reports = page.locator(".workflow__reports li");
  await expect(reports).toHaveCount(2, { timeout: 30000 });
  await expect(reports.nth(0)).toContainText("Rotate pages");
  await expect(reports.nth(1)).toContainText("Compress");
  await expect(page.getByRole("link", { name: /one\.pdf$/ })).toBeVisible();
});

test("keeps the run button disabled until files and steps exist", async ({ page }) => {
  const runButton = page.getByRole("button", { name: "Run workflow" });
  await expect(runButton).toBeDisabled();
  await page.locator("#workflow-step").selectOption("compress");
  await page.getByRole("button", { name: "Add step" }).click();
  await expect(runButton).toBeDisabled();
  await page.getByLabel("Choose workflow input files").setInputFiles({
    name: "one.pdf",
    mimeType: "application/pdf",
    buffer: await makePdf(1),
  });
  await expect(runButton).toBeEnabled();
});

test("downloads every output as a valid ZIP archive", async ({ page }) => {
  const { unzipSync } = await import("fflate");

  await page.getByLabel("Name").fill("Split three pages");
  await page.locator("#workflow-step").selectOption("split");
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Choose workflow input files").setInputFiles({
    name: "three.pdf",
    mimeType: "application/pdf",
    buffer: await makePdf(3),
  });

  await page.getByRole("button", { name: "Run workflow" }).click();
  await expect(page.getByRole("link", { name: /three-p3\.pdf$/ })).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".merge-success li")).toHaveCount(3);

  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download all as ZIP" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("Split three pages-outputs.zip");

  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = new Uint8Array(await readFile(path!));
  expect(bytes[0]).toBe(0x50);
  expect(bytes[1]).toBe(0x4b);

  const entries = unzipSync(bytes);
  const names = Object.keys(entries).sort();
  expect(names).toEqual(["three-p1.pdf", "three-p2.pdf", "three-p3.pdf"]);
  for (const name of names) {
    expect(new TextDecoder().decode(entries[name].subarray(0, 5))).toBe("%PDF-");
  }
});
