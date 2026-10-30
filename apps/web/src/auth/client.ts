import { createAuthClient } from "better-auth/client";
import { anonymousClient, magicLinkClient } from "better-auth/client/plugins";

/**
 * Only used to start a sign-in and to sign out. The browser keeps the session in an HttpOnly cookie; the
 * app learns who you are from GET /api/me and never reads the session or its token.
 */
export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? undefined : window.location.origin,
  plugins: [magicLinkClient(), anonymousClient()],
});
