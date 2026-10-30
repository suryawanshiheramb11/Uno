import type { Env } from "./env";

const MAIL_TIMEOUT_MS = 8000;

/** True when this address belongs to the automated-test domain on a non-production deployment. */
export function isE2eAddress(env: Env, email: string): boolean {
  const domain = env.E2E_EMAIL_DOMAIN?.toLowerCase();
  return (
    env.ENVIRONMENT !== "production" &&
    !!env.E2E_SECRET &&
    !!domain &&
    email.toLowerCase().endsWith(`@${domain}`)
  );
}

/**
 * Delivers a sign-in link.
 *  - test-domain address on staging/local with E2E_SECRET set: stored in the e2e outbox, not emailed
 *  - RESEND_API_KEY set: emailed through Resend
 *  - local dev with nothing configured: printed to the console
 *  - anywhere else: fails loudly rather than silently dropping the link
 */
export async function sendMagicLinkEmail(
  env: Env,
  data: { email: string; url: string },
): Promise<void> {
  if (isE2eAddress(env, data.email)) {
    await env.DB.prepare("INSERT INTO e2e_outbox (email, url, created_at) VALUES (?, ?, ?)")
      .bind(data.email.toLowerCase(), data.url, Date.now())
      .run();
    return;
  }
  if (env.RESEND_API_KEY && env.MAIL_FROM) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [data.email],
        subject: "Your UNO sign-in link",
        text: `Sign in to UNO: ${data.url}\n\nThis link works once and expires in 10 minutes. If you didn't ask for it, ignore this email.`,
      }),
    });
    if (!response.ok) throw new Error(`Email provider rejected the message (${response.status})`);
    return;
  }
  if (env.ENVIRONMENT === "local") {
    console.log(`[magic link] ${data.email}: ${data.url}`);
    return;
  }
  throw new Error("Email delivery is not configured: set RESEND_API_KEY and MAIL_FROM.");
}
