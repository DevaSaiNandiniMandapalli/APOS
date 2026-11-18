import { expect, test } from "@playwright/test";

const PAGES = ["/", "/studios", "/faq", "/tools/merge-pdf", "/tools/workflow-builder", "/server-tools"];

type Violation = { directive: string; blocked: string; source: string };

test("serves the security headers on every page", async ({ page }) => {
  for (const path of PAGES) {
    const response = await page.goto(path);
    expect(response, `no response for ${path}`).toBeTruthy();
    const headers = response!.headers();
    expect(headers["content-security-policy"], `missing CSP on ${path}`).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  }
});

test("loads the main pages without a Content-Security-Policy violation", async ({ page }) => {
  await page.addInitScript(() => {
    const violations: Violation[] = [];
    Object.defineProperty(window, "__cspViolations", { value: violations });
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push({ directive: event.violatedDirective, blocked: event.blockedURI, source: event.sourceFile });
    });
  });

  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("load");
    await page.waitForTimeout(300);
    const violations = await page.evaluate(() => (window as unknown as { __cspViolations: Violation[] }).__cspViolations);
    // Zod probes `Function("")` once to decide whether it may use the faster
    // eval-based parser. The CSP blocks it, Zod falls back, and nothing breaks.
    const unexpected = violations.filter((violation) => !(violation.directive === "script-src" && violation.blocked === "eval"));
    expect(unexpected, `CSP violations on ${path}`).toEqual([]);
  }
});
