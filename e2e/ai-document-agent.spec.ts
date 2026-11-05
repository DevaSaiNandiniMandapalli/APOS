import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { readFile } from "node:fs/promises";

const ANSWER = `# Service agreement

The client pays 1200 USD monthly, due within 30 days.

## Charges

| Item | Amount |
| --- | --- |
| Monthly fee | 1200 |
| Late interest | 2% |

- Notice period is 60 days
- Reports are due by the 5th`;

test("turns a text file plus instructions into a Word document", async ({ page }) => {
  let sent: { task?: string; instructions?: string } = {};
  await page.route("**/api/ai", async (route) => {
    sent = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answer: ANSWER }) });
  });

  await page.goto("/tools/ai-document-agent");
  await page.getByLabel("Source document").setInputFiles({
    name: "terms.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Client pays 1200 USD monthly. Notice is 60 days. Reports due by the 5th."),
  });
  await page.getByRole("button", { name: "Formal letter" }).click();
  await page.getByRole("button", { name: "Generate Word document" }).click();

  await expect(page.locator(".agent__result")).toBeVisible();
  expect(sent.task).toBe("document");
  expect(sent.instructions).toContain("formal business letter");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /Download terms-edited\.docx/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("terms-edited.docx");

  const entries = unzipSync(new Uint8Array(await readFile((await download.path()) as string)));
  const xml = new TextDecoder().decode(entries["word/document.xml"]);
  expect(xml).toContain("<w:tbl>");
  expect(xml).toContain("Monthly fee");
  expect(xml).toContain("Service agreement");
});

test("shows the server error when the AI is not configured", async ({ page }) => {
  await page.route("**/api/ai", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "AI is not configured on this server." }) }),
  );
  await page.goto("/tools/ai-document-agent");
  await page.getByLabel("Source document").setInputFiles({ name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("Some text.") });
  await page.getByLabel("What should the new document contain?").fill("Make a summary letter.");
  await page.getByRole("button", { name: "Generate Word document" }).click();
  await expect(page.locator(".merge-error")).toContainText("not configured");
});

test("requires instructions before generating", async ({ page }) => {
  await page.goto("/tools/ai-document-agent");
  await page.getByLabel("Source document").setInputFiles({ name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("Some text.") });
  await expect(page.getByRole("button", { name: "Generate Word document" })).toBeDisabled();
});
