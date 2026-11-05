import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { buildDocx } from "../src/lib/office-formats";

async function downloadBytes(page: import("@playwright/test").Page, linkName: RegExp): Promise<{ name: string; bytes: Uint8Array }> {
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: linkName }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile((await download.path()) as string)) };
}

test("converts a CSV file into an Excel workbook", async ({ page }) => {
  await page.goto("/tools/universal-converter");
  await page.getByLabel("Your file").setInputFiles({ name: "costs.csv", mimeType: "text/csv", buffer: Buffer.from("Item,Amount\nRent,1200\nPower,80\n") });
  await page.getByLabel("What do you want?").fill("turn into excel");
  await expect(page.locator(".univ__plan")).toContainText("Build an Excel workbook");
  await page.getByRole("button", { name: "Convert", exact: true }).click();
  const { name, bytes } = await downloadBytes(page, /Download costs\.xlsx/);
  expect(name).toBe("costs.xlsx");
  expect(Object.keys(unzipSync(bytes))).toContain("xl/workbook.xml");
});

test("converts a text file into a PDF", async ({ page }) => {
  await page.goto("/tools/universal-converter");
  await page.getByLabel("Your file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("First paragraph.\n\nSecond paragraph.") });
  await page.getByLabel("What do you want?").fill("convert to PDF");
  await page.getByRole("button", { name: "Convert", exact: true }).click();
  const { name, bytes } = await downloadBytes(page, /Download notes\.pdf/);
  expect(name).toBe("notes.pdf");
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
});

test("converts a Word file into a PDF", async ({ page }) => {
  await page.goto("/tools/universal-converter");
  await page.getByLabel("Your file").setInputFiles({
    name: "report.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(buildDocx(["Quarterly report", "Revenue grew by 12%."], "Report")),
  });
  await page.getByLabel("What do you want?").fill("Convert to PDF");
  await page.getByRole("button", { name: "Convert", exact: true }).click();
  const { bytes } = await downloadBytes(page, /Download report\.pdf/);
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
});

test("converts a PNG image into a JPG", async ({ page }) => {
  await page.goto("/tools/universal-converter");
  const png = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 4; canvas.height = 4;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.fillStyle = "#d42924"; context.fillRect(0, 0, 4, 4);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value as Blob), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByLabel("Your file").setInputFiles({ name: "swatch.png", mimeType: "image/png", buffer: Buffer.from(png) });
  await page.getByLabel("What do you want?").fill("Change to JPG");
  await page.getByRole("button", { name: "Convert", exact: true }).click();
  const { name, bytes } = await downloadBytes(page, /Download swatch\.jpg/);
  expect(name).toBe("swatch.jpg");
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
});

test("refuses a path it cannot do instead of pretending", async ({ page }) => {
  await page.goto("/tools/universal-converter");
  await page.getByLabel("Your file").setInputFiles({ name: "deck.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n") });
  await page.getByLabel("What do you want?").fill("convert to powerpoint");
  await expect(page.locator(".univ__plan")).toContainText("not supported yet");
  await expect(page.getByRole("button", { name: "Convert", exact: true })).toBeDisabled();
});
