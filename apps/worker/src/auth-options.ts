import type { BetterAuthOptions } from "better-auth";
import { anonymous } from "better-auth/plugins/anonymous";
import { magicLink } from "better-auth/plugins/magic-link";

export interface AuthParams {
  /** Public origin of this deployment, e.g. https://staging.uno.example.com */
  appUrl: string;
  secret: string;
  /** Google sign-in is offered only when both are set. */
  googleClientId?: string;
  googleClientSecret?: string;
  sendMagicLink: (data: { email: string; url: string; token: string }) => Promise<void> | void;
  /** Called when a guest signs in to a real account, so their stats and match history can move across. */
  linkGuest?: (guestUserId: string, newUserId: string) => Promise<void> | void;
}

const SESSION_DAYS = 30;

/**
 * Everything about our Better Auth setup except the database, so the same options feed both the
 * Worker (with the D1 binding) and the CLI that generates the migration.
 */
export function createAuthOptions(p: AuthParams): Omit<BetterAuthOptions, "database"> {
  const secure = p.appUrl.startsWith("https://");
  return {
    appName: "UNO",
    baseURL: p.appUrl,
    secret: p.secret,
    trustedOrigins: [p.appUrl],
    emailAndPassword: { enabled: false },
    socialProviders:
      p.googleClientId && p.googleClientSecret
        ? { google: { clientId: p.googleClientId, clientSecret: p.googleClientSecret } }
        : {},
    // A Google sign-in and a magic link for the same verified email are the same person.
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    plugins: [
      // One-click guest accounts. A guest is a real (anonymous) user with a session, so everything else works the
      // same; signing in later hands their progress to the new account and removes the guest.
      anonymous({
        emailDomainName: "guest.uno.invalid",
        generateName: () => `Guest ${Math.floor(1000 + Math.random() * 9000)}`,
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await p.linkGuest?.(anonymousUser.user.id, newUser.user.id);
        },
      }),
      magicLink({
        expiresIn: 10 * 60,
        sendMagicLink: ({ email, url, token }) => p.sendMagicLink({ email, url, token }),
      }),
    ],
    session: {
      expiresIn: 60 * 60 * 24 * SESSION_DAYS,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      cookiePrefix: "uno",
      useSecureCookies: secure,
      // HttpOnly + Secure + SameSite=Lax, set explicitly rather than relying on defaults.
      defaultCookieAttributes: { httpOnly: true, secure, sameSite: "lax", path: "/" },
    },
  };
}
