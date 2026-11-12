import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: {
    command: "npm run serve:static",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
