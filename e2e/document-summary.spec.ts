import { expect, test } from "@playwright/test";

const TEXT = "Payment terms are 30 days from invoice date. Late payments incur a 2% monthly fee.\nDelivery happens within 14 working days.\n";

test.beforeEach(async ({ page }) => {
  await page.goto("/tools/document-summary");
  await expect(page.getByRole("heading", { level: 1, name: "Document summary" })).toBeVisible();
});

test("extracts text and summarises through the AI endpoint", async ({ page }) => {
  const requests: { task?: string; text?: string }[] = [];
  await page.route("**/api/ai", async (route) => {
    requests.push(route.request().postDataJSON() as { task?: string; text?: string });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ answer: "Invoices are due in 30 days; delivery takes 14 working days." }),
    });
  });

  await page.getByLabel("Choose a document").setInputFiles({
    name: "contract.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(TEXT),
  });

  await expect(page.getByText(/characters extracted/)).toBeVisible();
  await page.getByRole("button", { name: "Summarize with Sarvam 105B" }).click();
  await expect(page.locator(".ai__answer")).toHaveText("Invoices are due in 30 days; delivery takes 14 working days.");
  expect(requests[0]?.task).toBe("summarize");
  expect(requests[0]?.text).toContain("Payment terms");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .md" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("contract-summary.md");
});

test("shows the server message when the AI key is missing", async ({ page }) => {
  await page.route("**/api/ai", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "AI is not configured on this server. An administrator must set SARVAM_API_KEY." }) }),
  );
  await page.getByLabel("Choose a document").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Some notes worth summarising."),
  });
  await page.getByRole("button", { name: "Summarize with Sarvam 105B" }).click();
  await expect(page.locator(".ai__error")).toContainText("SARVAM_API_KEY");
});

test("answers a follow-up question about the document", async ({ page }) => {
  let task: string | undefined;
  await page.route("**/api/ai", async (route) => {
    task = (route.request().postDataJSON() as { task?: string }).task;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answer: "30 days." }) });
  });
  await page.getByLabel("Choose a document").setInputFiles({
    name: "terms.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(TEXT),
  });
  await page.getByLabel("Ask about this document").fill("How long do we have to pay?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".ai__answer")).toHaveText("30 days.");
  expect(task).toBe("chat");
});

test("rejects an unsupported file type", async ({ page }) => {
  await page.getByLabel("Choose a document").setInputFiles({
    name: "scan.png",
    mimeType: "image/png",
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  await expect(page.locator(".ai__error")).toContainText("Use a PDF, Word");
});
