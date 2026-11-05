import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tools/document-editor");
  await expect(page.getByRole("heading", { level: 1, name: "Document editor" })).toBeVisible();
});

test("renders the editor, toolbar, page settings and title controls", async ({ page }) => {
  await expect(page.locator(".document-editor__pane")).toBeVisible();
  await expect(page.locator(".document-editor__toolbar")).toBeVisible();
  for (const label of ["Bold", "Italic", "Underline", "H1", "H2", "H3", "Bullet list", "Numbered list", "Link", "Table", "Image"]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeEnabled();
  }
  await expect(page.getByRole("combobox", { name: "Page size" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export PDF" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reopen", exact: true })).toBeVisible();
});

test("typing updates the document and autosaves locally", async ({ page }) => {
  const editor = page.locator(".document-editor__pane");
  await editor.click();
  await page.keyboard.type("Hello APOS Studio");
  await expect(editor).toContainText("Hello APOS Studio");
  await expect(page.getByText(/Saved locally/)).toBeVisible({ timeout: 10000 });
});

test("bold formatting toggles and the link dialog inserts a hyperlink", async ({ page }) => {
  const editor = page.locator(".document-editor__pane");
  await editor.click();
  await page.keyboard.type("APOS link");
  await page.keyboard.press("Control+A");

  await page.getByRole("button", { name: "Link", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Insert link" })).toBeVisible();
  await page.getByPlaceholder("https://example.com").fill("https://example.com");
  await page.getByRole("button", { name: "Update", exact: true }).click();

  await expect(page.locator(".document-editor__pane a").first()).toHaveAttribute(
    "href",
    "https://example.com",
  );
});

test("inserting a table renders a real table in the document", async ({ page }) => {
  let prompts = 0;
  page.on("dialog", (dialog) => {
    if (dialog.type() === "prompt") {
      prompts += 1;
      void dialog.accept("2");
    } else {
      void dialog.dismiss();
    }
  });

  await page.locator(".document-editor__pane").click();
  await page.getByRole("button", { name: "Table", exact: true }).click();

  const table = page.locator(".document-editor__pane table");
  await expect(table).toHaveCount(1);
  expect(await table.locator("tr").count()).toBeGreaterThan(0);
  expect(prompts).toBe(2);
});

test("heading formatting serializes without errors and saves a heading node", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const editor = page.locator(".document-editor__pane");
  await editor.click();
  await page.keyboard.type("Quarterly summary");
  await page.keyboard.press("Control+A");
  await page.getByRole("button", { name: "H1", exact: true }).click();
  await expect(page.locator(".document-editor__pane h1")).toContainText("Quarterly summary");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let raw = "";
  for await (const chunk of stream) raw += chunk.toString();
  expect(raw).toContain('"type": "h1"');
  expect(pageErrors).toEqual([]);
});
