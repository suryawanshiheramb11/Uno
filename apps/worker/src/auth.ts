import { betterAuth } from "better-auth";
import { createAuthOptions } from "./auth-options";
import type { Env } from "./env";
import { sendMagicLinkEmail } from "./mail";
import { mergeGuestInto } from "./profile-store";

/**
 * Better Auth bound to this request's D1 database. Passing the D1 binding straight to `database`
 * is Better Auth's own Cloudflare D1 support (it detects the binding and uses its D1 dialect);
 * Better Auth owns the user/session/account/verification tables (migration 0001).
 * Bindings only exist per request in a Worker, hence a factory rather than a module-level instance.
 */
export function createAuth(env: Env) {
  return betterAuth({
    ...createAuthOptions({
      appUrl: env.APP_URL,
      secret: env.BETTER_AUTH_SECRET,
      googleClientId: env.GOOGLE_CLIENT_ID,
      googleClientSecret: env.GOOGLE_CLIENT_SECRET,
      sendMagicLink: ({ email, url }) => sendMagicLinkEmail(env, { email, url }),
      linkGuest: (guestId, userId) => mergeGuestInto(env.DB, guestId, userId),
    }),
    database: env.DB,
  });
}

export type Auth = ReturnType<typeof createAuth>;
