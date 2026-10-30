// Used only by `npm run auth:schema` to let the Better Auth CLI see our auth options and emit SQL.
// It never talks to a real database: node:sqlite in memory just tells the CLI to generate SQLite SQL.
import { DatabaseSync } from "node:sqlite";
import { createAuthOptions } from "../src/auth-options";

export const auth = (await import("better-auth")).betterAuth({
  ...createAuthOptions({
    appUrl: "https://staging.uno.example.com",
    secret: "schema-generation-only-not-a-real-secret-0000000000",
    googleClientId: "x",
    googleClientSecret: "x",
    sendMagicLink: async () => {},
  }),
  database: new DatabaseSync(":memory:") as never,
});
