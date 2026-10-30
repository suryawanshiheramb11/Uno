import { expect, test, type APIRequestContext } from "@playwright/test";

const E2E_SECRET = process.env.E2E_SECRET;
const E2E_DOMAIN = process.env.E2E_EMAIL_DOMAIN;
const configured = Boolean(E2E_SECRET && E2E_DOMAIN);

async function waitForMagicLink(request: APIRequestContext, email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await request.get(`/api/test/magic-link?email=${encodeURIComponent(email)}`, {
      headers: { "x-e2e-secret": E2E_SECRET as string },
    });
    if (res.ok()) return ((await res.json()) as { url: string }).url;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No magic link arrived for ${email}`);
}

test.describe("sign-in", () => {
  test.skip(
    !configured,
    "set E2E_SECRET and E2E_EMAIL_DOMAIN (the deployment must have the same values)",
  );

  test("signs in by magic link, survives a reload and a browser restart, then signs out", async ({
    page,
    browser,
    request,
    baseURL,
  }) => {
    const email = `pw-${Date.now()}@${E2E_DOMAIN}`;

    // Signed out: the API refuses and the dashboard bounces to sign-in.
    expect((await request.get("/api/me")).status()).toBe(401);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    // Ask for a link, then follow it (the e2e outbox stands in for the inbox).
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("status")).toContainText(email);
    await page.goto(await waitForMagicLink(request, email));

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("signin-state")).toHaveText("Signed in");
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();

    // The session cookie is HttpOnly: page scripts cannot read it.
    expect(await page.evaluate(() => document.cookie)).not.toContain("session_token");

    // Survives a reload.
    await page.reload();
    await expect(page.getByTestId("signin-state")).toHaveText("Signed in");

    // Survives a browser restart: keep only what a browser would persist, open a brand-new context.
    const saved = await page.context().storageState();
    expect(saved.cookies.some((c) => c.name.endsWith("session_token") && c.httpOnly)).toBe(true);
    const restarted = await browser.newContext({ storageState: saved, baseURL });
    const again = await restarted.newPage();
    await again.goto("/dashboard");
    await expect(again.getByTestId("signin-state")).toHaveText("Signed in");

    // Profile edits stick.
    await again.goto("/profile");
    const name = `PW ${String(Date.now()).slice(-8)}`;
    await again.getByLabel("Display name").fill(name);
    await again.getByRole("button", { name: "Save profile" }).click();
    await expect(again.getByText("Saved.")).toBeVisible();
    await again.reload();
    await expect(again.getByLabel("Display name")).toHaveValue(name);

    // Sign out ends the session everywhere.
    await again.getByRole("button", { name: "Sign out" }).click();
    await expect(again.getByRole("heading", { name: "Sign in" })).toBeVisible();
    expect((await restarted.request.get("/api/me")).status()).toBe(401);
    await restarted.close();
  });

  test("the Google button starts OAuth with the registered callback URL", async ({
    page,
    baseURL,
  }) => {
    test.skip(
      !process.env.EXPECT_GOOGLE,
      "set EXPECT_GOOGLE=1 when the deployment has Google credentials",
    );
    await page.route("https://accounts.google.com/**", (route) =>
      route.fulfill({ status: 200, body: "google" }),
    );
    await page.goto("/sign-in");
    const navigation = page.waitForRequest((r) =>
      r.url().startsWith("https://accounts.google.com/"),
    );
    await page.getByRole("button", { name: /Continue with Google/ }).click();
    const url = new URL((await navigation).url());
    expect(url.searchParams.get("redirect_uri")).toBe(`${baseURL}/api/auth/callback/google`);
  });
});
