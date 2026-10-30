import { expect, test } from "@playwright/test";

const E2E_SECRET = process.env.E2E_SECRET;
const E2E_DOMAIN = process.env.E2E_EMAIL_DOMAIN;

test.describe("guest account", () => {
  test("one click creates a guest who survives a reload and a browser restart", async ({
    page,
    browser,
    request,
    baseURL,
  }) => {
    expect((await request.get("/api/me")).status()).toBe(401);

    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Continue as guest" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("signin-state")).toHaveText("Guest");
    await expect(page.getByRole("heading", { name: /Welcome back, Guest \d{4}/ })).toBeVisible();
    await expect(page.getByLabel("Guest account")).toContainText("playing as a guest");
    expect(await page.evaluate(() => document.cookie)).not.toContain("session_token");

    await page.reload();
    await expect(page.getByTestId("signin-state")).toHaveText("Guest");

    const saved = await page.context().storageState();
    expect(saved.cookies.some((c) => c.name.endsWith("session_token") && c.httpOnly)).toBe(true);
    const restarted = await browser.newContext({ storageState: saved, baseURL });
    const again = await restarted.newPage();
    await again.goto("/dashboard");
    await expect(again.getByTestId("signin-state")).toHaveText("Guest");
    await restarted.close();
  });

  test("a guest who signs in becomes a real account", async ({ page, request }) => {
    test.skip(
      !E2E_SECRET || !E2E_DOMAIN,
      "needs E2E_SECRET and E2E_EMAIL_DOMAIN to read the magic link",
    );
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Continue as guest" }).click();
    await expect(page.getByTestId("signin-state")).toHaveText("Guest");
    const guestName =
      (await page.getByRole("heading", { name: /Welcome back/ }).textContent()) ?? "";

    await page.getByRole("link", { name: "Sign in to save progress" }).click();
    await expect(page.getByText(/You're playing as a guest/)).toBeVisible();
    const email = `pw-guest-${Date.now()}@${E2E_DOMAIN}`;
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("status")).toContainText(email);

    let url = "";
    for (let i = 0; i < 20 && !url; i++) {
      const res = await request.get(`/api/test/magic-link?email=${encodeURIComponent(email)}`, {
        headers: { "x-e2e-secret": E2E_SECRET as string },
      });
      if (res.ok()) url = ((await res.json()) as { url: string }).url;
      else await new Promise((r) => setTimeout(r, 500));
    }
    await page.goto(url);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("signin-state")).toHaveText("Signed in");
    await expect(page.getByLabel("Guest account")).toHaveCount(0);
    expect(guestName).toContain("Guest");
  });
});
