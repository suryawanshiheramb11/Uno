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
}
