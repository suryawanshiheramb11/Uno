import { defineConfig } from "@playwright/test";

// Run against staging: BASE_URL=https://staging.uno.example.com E2E_SECRET=... E2E_EMAIL_DOMAIN=... npx playwright test
// Run against a local `wrangler dev`: BASE_URL=http://localhost:8787 (see e2e/README.md).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  // Serial: keeps runs against one shared database simple and repeatable.
  workers: 1,
  // The first sign-in after a cold start (fresh local DB, new Worker isolate) can take several seconds.
  expect: { timeout: 12_000 },
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:8787", trace: "retain-on-failure" },
});
