import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

// Inline Miniflare config: tests must not depend on a built apps/web/dist.
// The real migrations in ./migrations run against a fresh local D1 before every test file.
const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2026-10-01",
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          ENVIRONMENT: "staging",
          APP_URL: "https://staging.uno.example.com",
          GIT_SHA: "abc123",
          PROTOCOL_VERSION: "1",
          BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123456",
          GOOGLE_CLIENT_ID: "test-google-client-id.apps.googleusercontent.com",
          GOOGLE_CLIENT_SECRET: "test-google-client-secret",
          E2E_SECRET: "test-e2e-secret",
          E2E_EMAIL_DOMAIN: "e2e.test",
          TEST_MIGRATIONS: migrations,
        },
        durableObjects: { ROOM: "Room", MATCHMAKER: "Matchmaker", PRESENCE: "Presence" },
        d1Databases: ["DB"],
        serviceBindings: {
          ASSETS: () =>
            new Response("<!doctype html><title>spa</title>", {
              headers: { "content-type": "text/html" },
            }),
        },
      },
    }),
  ],
  test: { setupFiles: ["./test/apply-migrations.ts"] },
});
