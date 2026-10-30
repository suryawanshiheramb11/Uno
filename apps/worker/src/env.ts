import type { Environment } from "@uno/shared";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ROOM: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
  PRESENCE: DurableObjectNamespace;
  ENVIRONMENT: Environment;
  APP_URL: string;
  PROTOCOL_VERSION: string;
  GIT_SHA: string;
  // ---- secrets (`wrangler secret put`), never in wrangler.jsonc ----
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Resend API key; magic links cannot be emailed without it (outside local dev and e2e). */
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  /** Enables the e2e magic-link outbox on non-production environments. */
  E2E_SECRET?: string;
  /** Only addresses at this domain are captured in the outbox instead of emailed. */
  E2E_EMAIL_DOMAIN?: string;
}
