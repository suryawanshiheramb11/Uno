import { env, exports } from "cloudflare:workers";
import { expect } from "vitest";

export const ORIGIN = "https://staging.uno.example.com";

export function call(path: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }));
}

/** `Headers.getSetCookie()` exists at runtime but is missing from the Workers type definitions. */
export const setCookies = (res: Response): string[] =>
  (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();

export const jsonInit = (
  method: string,
  body: unknown,
  extra: Record<string, string> = {},
): RequestInit => ({
  method,
  headers: { "content-type": "application/json", origin: ORIGIN, ...extra },
  body: JSON.stringify(body),
});

let counter = 0;
export const uniqueEmail = (label = "user") => `${label}-${Date.now()}-${++counter}@e2e.test`;

/**
 * The real sign-in flow, end to end: ask for a magic link (captured in the e2e outbox because the
 * address is on the test domain), follow the link, and keep the session cookie the Worker sets.
 */
export async function signIn(
  email: string,
  /** A session cookie to send along, e.g. a guest session that should be carried over to this account. */
  existingCookie?: string,
): Promise<{ cookie: string; setCookies: string[] }> {
  const ask = await call(
    "/api/auth/sign-in/magic-link",
    jsonInit("POST", { email, callbackURL: "/dashboard" }),
    existingCookie,
  );
  expect(ask.status).toBe(200);
  const row = await env.DB.prepare(
    "SELECT url FROM e2e_outbox WHERE email = ? ORDER BY id DESC LIMIT 1",
  )
    .bind(email.toLowerCase())
    .first<{ url: string }>();
  expect(row, "magic link should be in the outbox").not.toBeNull();
  const link = new URL((row as { url: string }).url);
  // Do not follow the redirect to the callback page: the session cookie is on the 302 itself.
  const verify = await call(link.pathname + link.search, { redirect: "manual" }, existingCookie);
  expect(verify.status).toBe(302);
  expect(verify.headers.get("location")).toContain("/dashboard");
  const cookies = setCookies(verify);
  expect(cookies.length).toBeGreaterThan(0);
  return { cookie: cookies.map((c) => c.split(";")[0]).join("; "), setCookies: cookies };
}

/** One-click guest account: Better Auth's anonymous sign-in. Returns the session cookie. */
export async function signInAsGuest(): Promise<{ cookie: string; setCookies: string[] }> {
  const res = await call("/api/auth/sign-in/anonymous", jsonInit("POST", {}));
  expect(res.status).toBe(200);
  const cookies = setCookies(res);
  expect(cookies.length).toBeGreaterThan(0);
  return { cookie: cookies.map((c) => c.split(";")[0]).join("; "), setCookies: cookies };
}
