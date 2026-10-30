import {
  PROTOCOL_VERSION,
  VARIANTS,
  validateAvatarSeed,
  validateDisplayName,
  validatePreferencesPatch,
} from "@uno/shared";
import type { ErrorCode, HealthResponse, MatchesResponse, ProtocolResponse } from "@uno/shared";
import { createAuth } from "./auth";
import type { Env } from "./env";
import { isE2eAddress } from "./mail";
import {
  ConflictError,
  getMe,
  listMatches,
  updatePreferences,
  updateProfile,
  type SessionUser,
} from "./profile-store";

const STATUS: Record<ErrorCode, number> = {
  ERR_PROTOCOL_UNSUPPORTED: 426,
  ERR_UNAUTHORIZED: 401,
  ERR_FORBIDDEN: 403,
  ERR_VALIDATION: 400,
  ERR_CONFLICT: 409,
  ERR_NOT_FOUND: 404,
  ERR_RATE_LIMITED: 429,
  ERR_INTERNAL: 500,
};

export function json(body: unknown, status = 200, extra: HeadersInit = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...extra } });
}

export function apiError(code: ErrorCode, message: string, extra: HeadersInit = {}): Response {
  return json({ error: { code, message } }, STATUS[code], extra);
}

/** Per-request context set by the auth middleware. `userId` is only ever derived from the session cookie. */
export interface ApiContext {
  userId: string | null;
  user: SessionUser | null;
  url: URL;
}

type Handler = (request: Request, env: Env, ctx: ApiContext) => Promise<Response> | Response;
interface Route {
  method: "GET" | "PATCH";
  path: string;
  /** Requires a signed-in user; otherwise the middleware answers 401. */
  auth: boolean;
  handler: Handler;
}

// ---------------------------------------------------------------- helpers

function sameOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin");
  // Browsers always send Origin on cross-site writes; a request without one is not a browser CSRF.
  return origin === null || origin === new URL(env.APP_URL).origin;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | Response> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return apiError("ERR_VALIDATION", "Content-Type must be application/json.");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("ERR_VALIDATION", "Request body is not valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return apiError("ERR_VALIDATION", "Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] as number) ^ (y[i] as number);
  return diff === 0;
}

// ---------------------------------------------------------------- routes

const requireUser = (ctx: ApiContext): SessionUser => ctx.user as SessionUser;

const routes: Route[] = [
  {
    method: "GET",
    path: "/api/health",
    auth: false,
    handler: (_r, env) => {
      const body: HealthResponse = { ok: true, environment: env.ENVIRONMENT, version: env.GIT_SHA };
      return json(body);
    },
  },
  {
    method: "GET",
    path: "/api/protocol",
    auth: false,
    handler: () => {
      const body: ProtocolResponse = { protocolVersion: PROTOCOL_VERSION, variants: VARIANTS };
      return json(body);
    },
  },
  {
    method: "GET",
    path: "/api/me",
    auth: true,
    handler: async (_r, env, ctx) => json(await getMe(env.DB, requireUser(ctx))),
  },
  {
    method: "PATCH",
    path: "/api/me/profile",
    auth: true,
    handler: async (request, env, ctx) => {
      const body = await readJsonObject(request);
      if (body instanceof Response) return body;
      const changes: { displayName?: string; avatarSeed?: string } = {};
      for (const [key, value] of Object.entries(body)) {
        if (key === "displayName") {
          const v = validateDisplayName(value);
          if (!v.ok) return apiError("ERR_VALIDATION", v.message);
          changes.displayName = v.value;
        } else if (key === "avatarSeed") {
          const v = validateAvatarSeed(value);
          if (!v.ok) return apiError("ERR_VALIDATION", v.message);
          changes.avatarSeed = v.value;
        } else {
          // Anything else (wins, elo, userId, ...) is refused, never silently ignored.
          return apiError("ERR_VALIDATION", `Field cannot be changed here: ${key}`);
        }
      }
      if (Object.keys(changes).length === 0)
        return apiError("ERR_VALIDATION", "Nothing to update.");
      try {
        return json({ profile: await updateProfile(env.DB, requireUser(ctx), changes) });
      } catch (e) {
        if (e instanceof ConflictError) return apiError("ERR_CONFLICT", e.message);
        throw e;
      }
    },
  },
  {
    method: "PATCH",
    path: "/api/me/preferences",
    auth: true,
    handler: async (request, env, ctx) => {
      const body = await readJsonObject(request);
      if (body instanceof Response) return body;
      const v = validatePreferencesPatch(body);
      if (!v.ok) return apiError("ERR_VALIDATION", v.message);
      return json({ preferences: await updatePreferences(env.DB, requireUser(ctx), v.value) });
    },
  },
  {
    method: "GET",
    path: "/api/me/matches",
    auth: true,
    handler: async (_r, env, ctx) => {
      const raw = ctx.url.searchParams.get("limit");
      let limit = 20;
      if (raw !== null) {
        if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) {
          return apiError("ERR_VALIDATION", "limit must be a whole number from 1 to 100.");
        }
        limit = Number(raw);
      }
      const body: MatchesResponse = {
        matches: await listMatches(env.DB, requireUser(ctx).id, limit),
      };
      return json(body);
    },
  },
  {
    // Automated sign-in tests read their magic link here. Hidden (404) unless E2E_SECRET is set on a
    // non-production deployment, and only ever serves addresses on the configured test domain.
    method: "GET",
    path: "/api/test/magic-link",
    auth: false,
    handler: async (request, env, ctx) => {
      const secret = env.E2E_SECRET;
      const email = ctx.url.searchParams.get("email") ?? "";
      if (!secret || env.ENVIRONMENT === "production")
        return apiError("ERR_NOT_FOUND", "Unknown API route");
      if (!timingSafeEqual(request.headers.get("x-e2e-secret") ?? "", secret)) {
        return apiError("ERR_NOT_FOUND", "Unknown API route");
      }
      if (!isE2eAddress(env, email)) return apiError("ERR_VALIDATION", "Not a test address.");
      const row = await env.DB.prepare(
        "SELECT url FROM e2e_outbox WHERE email = ? ORDER BY id DESC LIMIT 1",
      )
        .bind(email.toLowerCase())
        .first<{ url: string }>();
      return row ? json({ url: row.url }) : apiError("ERR_NOT_FOUND", "No link yet.");
    },
  },
];

// ---------------------------------------------------------------- middleware + dispatch

export async function handleApi(request: Request, env: Env): Promise<Response> {
  try {
    // Never trust a client-supplied identity header: drop it before anything else sees the request.
    const headers = new Headers(request.headers);
    headers.delete("x-user-id");
    const clean = new Request(request, { headers });
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/auth/")) return await createAuth(env).handler(clean);

    // Resolve the session from the cookie and inject the user id (overwriting anything the client sent).
    let user: SessionUser | null = null;
    if (headers.has("cookie")) {
      const session = await createAuth(env).api.getSession({ headers });
      user = (session?.user as SessionUser | undefined) ?? null;
    }
    if (user) headers.set("x-user-id", user.id);
    const ctx: ApiContext = { userId: user?.id ?? null, user, url };

    const matching = routes.filter((r) => r.path === url.pathname);
    if (matching.length === 0) return apiError("ERR_NOT_FOUND", "Unknown API route");
    const method = request.method === "HEAD" ? "GET" : request.method;
    const route = matching.find((r) => r.method === method);
    if (!route) {
      return json({ error: { code: "ERR_NOT_FOUND", message: "Method not allowed" } }, 405, {
        allow: matching.map((r) => r.method).join(", "),
      });
    }
    if (route.auth && !user) return apiError("ERR_UNAUTHORIZED", "Sign in required.");
    if (route.method !== "GET" && !sameOrigin(request, env)) {
      return apiError("ERR_FORBIDDEN", "Cross-origin request refused.");
    }
    return await route.handler(clean, env, ctx);
  } catch (e) {
    console.error("api error", e instanceof Error ? e.message : e);
    return apiError("ERR_INTERNAL", "Something went wrong.");
  }
}
