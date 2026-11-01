import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";

type ImageFormat = "png" | "jpeg" | "webp";

const mimeTypes: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const signatureChecks: Record<ImageFormat, (bytes: Buffer) => boolean> = {
  png: (bytes) =>
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ),
  jpeg: (bytes) =>
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff,
  webp: (bytes) =>
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP",
};

async function createImageFixture(
  page: import("@playwright/test").Page,
  format: ImageFormat,
) {
  const dataUrl = await page.evaluate((mime) => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 24;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");

    context.fillStyle = "#e34b67";
    context.fillRect(0, 0, 32, 24);
    context.fillStyle = "#ffffff";
    context.fillRect(8, 6, 16, 12);

    return canvas.toDataURL(mime, 0.9);
  }, mimeTypes[format]);

  if (!dataUrl.startsWith(`data:${mimeTypes[format]};base64,`)) {
    throw new Error(`The browser could not generate a ${format} fixture.`);
  }

  return Buffer.from(dataUrl.split(",")[1], "base64");
}

const conversions: [ImageFormat, ImageFormat][] = [
  ["png", "jpeg"],
  ["png", "webp"],
  ["jpeg", "png"],
  ["jpeg", "webp"],
  ["webp", "png"],
  ["webp", "jpeg"],
];

for (const [inputFormat, outputFormat] of conversions) {
  test(`real browser conversion: ${inputFormat} to ${outputFormat}`, async ({ page }) => {
    await page.goto("/tools/image-converter");

    await expect(
      page.getByRole("heading", { name: "Convert images on this device" }),
    ).toBeVisible();

    const inputBytes = await createImageFixture(page, inputFormat);

    await page.getByLabel("Output format").selectOption(outputFormat);

    await page.locator('input[type="file"]').setInputFiles({
      name: `browser-fixture.${inputFormat}`,
      mimeType: mimeTypes[inputFormat],
      buffer: inputBytes,
    });

    await expect(page.locator(".conversion-item").getByText(new RegExp(`detected ${inputFormat.toUpperCase()}`))).toBeVisible();

    await page.getByRole("button", {
      name: "Convert 1 queued image",
    }).click();

    await expect(page.getByText(/Batch: 1 complete/)).toBeVisible({
      timeout: 15000,
    });

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", {
      name: new RegExp(`browser-fixture.*\.${outputFormat === "jpeg" ? "jpg" : outputFormat}$`, "i"),
    }).click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`\\.${outputFormat === "jpeg" ? "jpg" : outputFormat}$`, "i"),
    );

    const stream = await download.createReadStream();
    if (!stream) throw new Error("The browser did not provide the downloaded file.");

    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const outputBytes = Buffer.concat(chunks);

    expect(outputBytes.length).toBeGreaterThan(0);
    expect(signatureChecks[outputFormat](outputBytes)).toBe(true);

    const dimensions = await page.evaluate(async (base64) => {
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0),
      );
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "application/octet-stream" }),
      );

      const result = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return result;
    }, outputBytes.toString("base64"));

    expect(dimensions).toEqual({ width: 32, height: 24 });
  });
}

test("resizes images while preserving aspect ratio", async ({ page }) => {
  await page.goto("/tools/image-converter");
  const inputBytes = await createImageFixture(page, "png");

  await page.getByLabel("Output format").selectOption("webp");
  await page.getByLabel("Maximum width (pixels)").fill("16");

  await page.locator('input[type="file"]').setInputFiles({
    name: "resize-fixture.png",
    mimeType: "image/png",
    buffer: inputBytes,
  });

  await expect(page.locator(".conversion-item").getByText(/detected PNG/)).toBeVisible();

  await page.getByRole("button", { name: "Convert 1 queued image" }).click();
  await expect(page.getByText(/Batch: 1 complete/)).toBeVisible({ timeout: 15000 });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /resize-fixture.*\.webp$/i }).click();
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  if (!stream) throw new Error("Download stream unavailable.");

  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));

  const dimensions = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const result = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  }, Buffer.concat(chunks).toString("base64"));

  expect(dimensions).toEqual({ width: 16, height: 12 });
});

test("creates a ZIP containing completed image outputs", async ({ page }) => {
  await page.goto("/tools/image-converter");

  const first = await createImageFixture(page, "png");
  const second = await createImageFixture(page, "jpeg");

  await page.locator('input[type="file"]').setInputFiles([
    { name: "first.png", mimeType: "image/png", buffer: first },
    { name: "second.jpg", mimeType: "image/jpeg", buffer: second },
  ]);

  await expect(page.locator(".conversion-item").getByText(/detected PNG/)).toBeVisible();
  await expect(page.locator(".conversion-item").getByText(/detected JPEG/)).toBeVisible();

  await page.getByRole("button", { name: "Convert 2 queued images" }).click();
  await expect(page.getByText(/Batch: 2 complete/)).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", {
    name: "Download completed images as ZIP",
  }).click();

  await expect(page.getByText("ZIP archive is ready.")).toBeVisible({ timeout: 15000 });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download ZIP archive" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.zip$/i);

  const stream = await download.createReadStream();
  if (!stream) throw new Error("ZIP download stream unavailable.");

  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));

  const zip = Buffer.concat(chunks);
  expect(zip.length).toBeGreaterThan(22);
  expect(zip[0]).toBe(0x50);
  expect(zip[1]).toBe(0x4b);

  const entries = unzipSync(zip);
  expect(Object.keys(entries).sort()).toEqual([
    "first.webp",
    "second.webp",
  ]);

  for (const filename of ["first.webp", "second.webp"]) {
    const imageBytes = entries[filename];
    expect(imageBytes).toBeDefined();
    expect(imageBytes!.byteLength).toBeGreaterThan(0);
    expect(imageBytes![0]).toBe(0x52);
    expect(imageBytes![1]).toBe(0x49);
    expect(imageBytes![2]).toBe(0x46);
    expect(imageBytes![3]).toBe(0x46);
    expect(new TextDecoder().decode(imageBytes!.subarray(8, 12))).toBe("WEBP");
  }
});

test("clears a completed batch and allows a new batch", async ({ page }) => {
  await page.goto("/tools/image-converter");
  const inputBytes = await createImageFixture(page, "png");

  await page.locator('input[type="file"]').setInputFiles({
    name: "clear-fixture.png",
    mimeType: "image/png",
    buffer: inputBytes,
  });

  await expect(page.locator(".conversion-item").getByText(/detected PNG/)).toBeVisible();

  await page.getByRole("button", { name: "Convert 1 queued image" }).click();
  await expect(page.getByText(/Batch: 1 complete/)).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "Clear batch" }).click();

  await expect(page.locator(".conversion-item")).toHaveCount(0);
  await expect(page.getByLabel("Output format")).toBeEnabled();

  await page.locator('input[type="file"]').setInputFiles({
    name: "second-fixture.png",
    mimeType: "image/png",
    buffer: inputBytes,
  });

  await expect(page.locator(".conversion-item").getByText(/detected PNG/)).toBeVisible();
});