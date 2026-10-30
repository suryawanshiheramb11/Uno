import { PROTOCOL_VERSION, VARIANTS } from "@uno/shared";
import type { HealthResponse, ProtocolResponse } from "@uno/shared";
import type { Env } from "./env";

export { Room, Matchmaker, Presence } from "./durable-objects";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return json({ error: { code: "ERR_NOT_FOUND", message: "Method not allowed" } }, 405);
      }
      if (url.pathname === "/api/health") {
        const body: HealthResponse = {
          ok: true,
          environment: env.ENVIRONMENT,
          version: env.GIT_SHA,
        };
        return json(body);
      }
      if (url.pathname === "/api/protocol") {
        const body: ProtocolResponse = { protocolVersion: PROTOCOL_VERSION, variants: VARIANTS };
        return json(body);
      }
      return json({ error: { code: "ERR_NOT_FOUND", message: "Unknown API route" } }, 404);
    }

    // Everything else: static assets (SPA fallback is handled by the asset layer).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
