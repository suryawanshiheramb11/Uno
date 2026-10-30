import { defineConfig } from "@playwright/test";

// Installed but unused until Phase 2+. Run with BASE_URL=https://staging.uno.example.com.
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:8787" },
});
