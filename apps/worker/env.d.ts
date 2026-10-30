declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("./src/index");
    durableNamespaces: "Room" | "Matchmaker" | "Presence";
  }
  interface Env {
    ROOM: DurableObjectNamespace;
    MATCHMAKER: DurableObjectNamespace;
    PRESENCE: DurableObjectNamespace;
    DB: D1Database;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    BETTER_AUTH_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    E2E_SECRET: string;
    E2E_EMAIL_DOMAIN: string;
  }
}
