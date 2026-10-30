import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

// Inline Miniflare config: tests must not depend on a built apps/web/dist.
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2026-10-01",
        compatibilityFlags: ["nodejs_compat"],
        bindings: { ENVIRONMENT: "staging", GIT_SHA: "abc123", PROTOCOL_VERSION: "1" },
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
});
