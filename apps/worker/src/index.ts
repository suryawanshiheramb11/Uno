import { handleApi } from "./api";
import type { Env } from "./env";

export { Room, Matchmaker, Presence } from "./durable-objects";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);

    // Everything else: static assets (SPA fallback is handled by the asset layer).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
