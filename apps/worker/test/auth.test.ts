import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ORIGIN, call, jsonInit, setCookies, signIn, uniqueEmail } from "./helpers";

const me = async (cookie: string) => {
  const res = await call("/api/me", {}, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as any;
};

describe("signed out", () => {
  it("GET /api/me is 401 with a typed error", async () => {
    const res = await call("/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "ERR_UNAUTHORIZED", message: "Sign in required." },
    });
  });
  it("every account route is 401", async () => {
    expect((await call("/api/me/matches")).status).toBe(401);
    expect(
      (await call("/api/me/profile", jsonInit("PATCH", { displayName: "Nope Name" }))).status,
    ).toBe(401);
    expect((await call("/api/me/preferences", jsonInit("PATCH", { theme: "dark" }))).status).toBe(
      401,
    );
  });
  it("a garbage session cookie is 401", async () => {
    expect(
      (await call("/api/me", {}, "__Secure-uno.session_token=not-a-real-token.badsignature"))
        .status,
    ).toBe(401);
  });
  it("health and protocol stay public", async () => {
    expect((await call("/api/health")).status).toBe(200);
    expect((await call("/api/protocol")).status).toBe(200);
  });
  it("a client-supplied x-user-id does not authenticate anyone", async () => {
    const res = await call("/api/me", { headers: { "x-user-id": "someone-else" } });
    expect(res.status).toBe(401);
  });
});

describe("magic-link sign in", () => {
  it("sets an HttpOnly, Secure, SameSite=Lax session cookie", async () => {
    const { setCookies } = await signIn(uniqueEmail("cookie"));
    // Over HTTPS Better Auth adds the browser-enforced __Secure- prefix to the cookie name.
    const session = setCookies.find((c) => c.startsWith("__Secure-uno.session_token="));
    expect(session, setCookies.join(" | ")).toBeDefined();
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/Secure/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(session).toMatch(/Path=\//i);
  });
  it("a magic link works only once", async () => {
    const email = uniqueEmail("once");
    await signIn(email);
    const row = await env.DB.prepare(
      "SELECT url FROM e2e_outbox WHERE email = ? ORDER BY id DESC LIMIT 1",
    )
      .bind(email)
      .first<{ url: string }>();
    const link = new URL((row as { url: string }).url);
    const again = await call(link.pathname + link.search, { redirect: "manual" });
    expect(setCookies(again).some((c) => c.startsWith("uno.session_token="))).toBe(false);
  });
  it("an address outside the test domain fails loudly when no email provider is configured", async () => {
    const res = await call(
      "/api/auth/sign-in/magic-link",
      jsonInit("POST", { email: "real.person@example.com", callbackURL: "/dashboard" }),
    );
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
  it("Google sign-in redirects to Google with the staging callback URI", async () => {
    const res = await call(
      "/api/auth/sign-in/social",
      jsonInit("POST", { provider: "google", callbackURL: "/dashboard" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    const url = new URL(body.url);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/google`);
    expect(url.searchParams.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
  });
});

describe("GET /api/me", () => {
  it("returns the profile and zeroed stats for a new account", async () => {
    const email = uniqueEmail("fresh");
    const { cookie } = await signIn(email);
    const body = await me(cookie);
    expect(body.user.email).toBe(email);
    expect(body.profile.displayName).toMatch(/^[A-Za-z0-9 ]{3,20}$/);
    expect(body.profile.avatarSeed.length).toBeGreaterThan(0);
    expect(body.profile.preferences).toMatchObject({
      theme: "system",
      locale: "en",
      hasCompletedOnboarding: false,
    });
    expect(body.stats).toMatchObject({
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      currentStreak: 0,
      longestStreak: 0,
      elo: 1000,
    });
  });
  it("never exposes the session token to the frontend", async () => {
    const { cookie } = await signIn(uniqueEmail("leakcheck"));
    const token = decodeURIComponent(cookie.split("=")[1] ?? "").split(".")[0] as string;
    const text = await (await call("/api/me", {}, cookie)).text();
    expect(token.length).toBeGreaterThan(10);
    expect(text).not.toContain(token);
    expect(text).not.toMatch(/"(token|sessionToken|session|secret)"/i);
  });
  it("the session persists across many requests", async () => {
    const { cookie } = await signIn(uniqueEmail("persist"));
    const first = await me(cookie);
    for (let i = 0; i < 3; i++) expect((await me(cookie)).user.id).toBe(first.user.id);
  });
  it("is the same account when signing in again with the same email", async () => {
    const email = uniqueEmail("again");
    const a = await me((await signIn(email)).cookie);
    const b = await me((await signIn(email)).cookie);
    expect(b.user.id).toBe(a.user.id);
    expect(b.profile.displayName).toBe(a.profile.displayName);
  });
  it("ignores a spoofed x-user-id and returns the signed-in user", async () => {
    const a = await signIn(uniqueEmail("spoofa"));
    const b = await signIn(uniqueEmail("spoofb"));
    const idB = (await me(b.cookie)).user.id;
    const res = await call("/api/me", { headers: { "x-user-id": idB } }, a.cookie);
    expect(((await res.json()) as any).user.id).not.toBe(idB);
  });
});

describe("PATCH /api/me/profile", () => {
  it("updates the name and avatar and they round-trip", async () => {
    const { cookie } = await signIn(uniqueEmail("edit"));
    const res = await call(
      "/api/me/profile",
      jsonInit("PATCH", { displayName: "  Ada   Lovelace ", avatarSeed: "seed-7" }),
      cookie,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).profile).toMatchObject({
      displayName: "Ada Lovelace",
      avatarSeed: "seed-7",
    });
    expect((await me(cookie)).profile).toMatchObject({
      displayName: "Ada Lovelace",
      avatarSeed: "seed-7",
    });
  });
  it("a duplicate display name is a 409, case-insensitively", async () => {
    const name = `Taken ${Date.now() % 100000}`;
    const first = await signIn(uniqueEmail("dup1"));
    expect(
      (await call("/api/me/profile", jsonInit("PATCH", { displayName: name }), first.cookie))
        .status,
    ).toBe(200);
    const second = await signIn(uniqueEmail("dup2"));
    for (const attempt of [name, name.toUpperCase(), name.toLowerCase()]) {
      const res = await call(
        "/api/me/profile",
        jsonInit("PATCH", { displayName: attempt }),
        second.cookie,
      );
      expect(res.status).toBe(409);
      expect(((await res.json()) as any).error.code).toBe("ERR_CONFLICT");
    }
  });
  it("saving your own current name again is fine", async () => {
    const { cookie } = await signIn(uniqueEmail("same"));
    const name = (await me(cookie)).profile.displayName;
    expect(
      (await call("/api/me/profile", jsonInit("PATCH", { displayName: name }), cookie)).status,
    ).toBe(200);
  });
  it.each([["ab"], ["x".repeat(21)], ["bad!name"], ["émile"], ["   "], [42]])(
    "rejects the display name %j with 400",
    async (bad) => {
      const { cookie } = await signIn(uniqueEmail("bad"));
      const res = await call("/api/me/profile", jsonInit("PATCH", { displayName: bad }), cookie);
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error.code).toBe("ERR_VALIDATION");
    },
  );
  it.each(["wins", "elo", "gamesPlayed", "userId", "longestStreak"])(
    "refuses to write %s (stats are read-only)",
    async (field) => {
      const { cookie } = await signIn(uniqueEmail("stats"));
      const before = (await me(cookie)).stats;
      const res = await call(
        "/api/me/profile",
        jsonInit("PATCH", { displayName: "Fair Play", [field]: 9999 }),
        cookie,
      );
      expect(res.status).toBe(400);
      expect((await me(cookie)).stats).toEqual(before);
    },
  );
  it("rejects an empty update and non-JSON bodies", async () => {
    const { cookie } = await signIn(uniqueEmail("empty"));
    expect((await call("/api/me/profile", jsonInit("PATCH", {}), cookie)).status).toBe(400);
    const res = await call(
      "/api/me/profile",
      { method: "PATCH", headers: { origin: ORIGIN, "content-type": "text/plain" }, body: "hi" },
      cookie,
    );
    expect(res.status).toBe(400);
  });
  it("refuses a cross-site request even with a valid cookie", async () => {
    const { cookie } = await signIn(uniqueEmail("csrf"));
    const res = await call(
      "/api/me/profile",
      jsonInit("PATCH", { displayName: "Evil Edit" }, { origin: "https://evil.example" }),
      cookie,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error.code).toBe("ERR_FORBIDDEN");
  });
});

describe("PATCH /api/me/preferences", () => {
  it("round-trips and merges partial updates", async () => {
    const { cookie } = await signIn(uniqueEmail("prefs"));
    const first = await call(
      "/api/me/preferences",
      jsonInit("PATCH", { theme: "dark", musicVolume: 25, locale: "pt-BR" }),
      cookie,
    );
    expect(first.status).toBe(200);
    await call(
      "/api/me/preferences",
      jsonInit("PATCH", { colorblindPalette: "shapes", hasCompletedOnboarding: true }),
      cookie,
    );
    const prefs = (await me(cookie)).profile.preferences;
    expect(prefs).toMatchObject({
      theme: "dark",
      musicVolume: 25,
      locale: "pt-BR",
      colorblindPalette: "shapes",
      hasCompletedOnboarding: true,
      soundEffects: true,
    });
  });
  it("covers every preference in the brief", async () => {
    const { cookie } = await signIn(uniqueEmail("allprefs"));
    const patch = {
      soundEffects: false,
      soundMusic: false,
      musicVolume: 0,
      colorblindPalette: "high-contrast",
      reducedMotion: "on",
      theme: "light",
      locale: "en",
      hasCompletedOnboarding: true,
    };
    const res = await call("/api/me/preferences", jsonInit("PATCH", patch), cookie);
    expect(((await res.json()) as any).preferences).toEqual(patch);
  });
  it.each([
    { theme: "neon" },
    { musicVolume: 101 },
    { soundEffects: "yes" },
    { elo: 3000 },
    { wins: 5 },
    {},
  ])("rejects %j with 400", async (bad) => {
    const { cookie } = await signIn(uniqueEmail("badprefs"));
    expect((await call("/api/me/preferences", jsonInit("PATCH", bad), cookie)).status).toBe(400);
  });
  it("one user's preferences never leak to another", async () => {
    const a = await signIn(uniqueEmail("pa"));
    const b = await signIn(uniqueEmail("pb"));
    await call("/api/me/preferences", jsonInit("PATCH", { theme: "dark" }), a.cookie);
    expect((await me(b.cookie)).profile.preferences.theme).toBe("system");
  });
});

describe("GET /api/me/matches", () => {
  const seedMatches = async (userId: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const id = `m-${userId.slice(0, 6)}-${i}`;
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO matches (match_id, variant, mode, started_at, ended_at, winner_id, rules_version) VALUES (?, 'classic', 'practice', ?, ?, ?, 1)",
        ).bind(id, 1000 + i, 2000 + i, userId),
        env.DB.prepare(
          "INSERT INTO match_players (match_id, seat_index, user_id, result, final_hand_size, is_bot) VALUES (?, 0, ?, 'win', 0, 0)",
        ).bind(id, userId),
        env.DB.prepare(
          "INSERT INTO match_players (match_id, seat_index, user_id, result, final_hand_size, is_bot) VALUES (?, 1, NULL, 'loss', 4, 1)",
        ).bind(id),
      ]);
    }
  };
  it("is empty for a new account", async () => {
    const { cookie } = await signIn(uniqueEmail("nomatch"));
    expect(await (await call("/api/me/matches", {}, cookie)).json()).toEqual({ matches: [] });
  });
  it("returns the newest first and honours limit", async () => {
    const { cookie } = await signIn(uniqueEmail("hist"));
    const id = (await me(cookie)).user.id;
    await seedMatches(id, 5);
    const all = ((await (await call("/api/me/matches", {}, cookie)).json()) as any).matches;
    expect(all).toHaveLength(5);
    expect(all.map((m: any) => m.startedAt)).toEqual([1004, 1003, 1002, 1001, 1000]);
    expect(all[0]).toMatchObject({
      variant: "classic",
      mode: "practice",
      result: "win",
      finalHandSize: 0,
      seatIndex: 0,
    });
    const two = ((await (await call("/api/me/matches?limit=2", {}, cookie)).json()) as any).matches;
    expect(two).toHaveLength(2);
  });
  it.each(["0", "101", "abc", "-1", "5.5"])("rejects limit=%s", async (limit) => {
    const { cookie } = await signIn(uniqueEmail("lim"));
    expect((await call(`/api/me/matches?limit=${limit}`, {}, cookie)).status).toBe(400);
  });
  it("never shows another player's matches", async () => {
    const a = await signIn(uniqueEmail("ma"));
    const b = await signIn(uniqueEmail("mb"));
    await seedMatches((await me(a.cookie)).user.id, 3);
    expect(((await (await call("/api/me/matches", {}, b.cookie)).json()) as any).matches).toEqual(
      [],
    );
  });
});

describe("signing out", () => {
  it("ends the session: /api/me is 401 afterwards", async () => {
    const { cookie } = await signIn(uniqueEmail("out"));
    expect((await call("/api/me", {}, cookie)).status).toBe(200);
    const out = await call("/api/auth/sign-out", jsonInit("POST", {}), cookie);
    expect(out.status).toBe(200);
    expect((await call("/api/me", {}, cookie)).status).toBe(401);
  });
});

describe("e2e sign-in hook", () => {
  it("is hidden without the secret", async () => {
    expect((await call("/api/test/magic-link?email=a@e2e.test")).status).toBe(404);
    expect(
      (
        await call("/api/test/magic-link?email=a@e2e.test", {
          headers: { "x-e2e-secret": "wrong" },
        })
      ).status,
    ).toBe(404);
  });
  it("returns the latest link for a test address with the secret", async () => {
    const email = uniqueEmail("hook");
    await call(
      "/api/auth/sign-in/magic-link",
      jsonInit("POST", { email, callbackURL: "/dashboard" }),
    );
    const res = await call(`/api/test/magic-link?email=${encodeURIComponent(email)}`, {
      headers: { "x-e2e-secret": env.E2E_SECRET },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).url).toContain("/api/auth/magic-link/verify");
  });
  it("refuses addresses outside the test domain", async () => {
    const res = await call("/api/test/magic-link?email=someone@example.com", {
      headers: { "x-e2e-secret": env.E2E_SECRET },
    });
    expect(res.status).toBe(400);
  });
});

describe("D1 schema", () => {
  const tables = async () =>
    (
      (
        await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
        ).all()
      ).results as { name: string }[]
    )
      .map((r) => r.name)
      .sort();
  it("migrations created Better Auth's tables and ours, and nothing parallel", async () => {
    expect(await tables()).toEqual(
      [
        "account",
        "e2e_outbox",
        "friendships",
        "match_players",
        "matches",
        "player_stats",
        "reports",
        "session",
        "user",
        "user_profiles",
        "verification",
      ].sort(),
    );
  });
  it("enforces the display-name length and uniqueness rules in the database itself", async () => {
    const { cookie } = await signIn(uniqueEmail("db"));
    const id = (await me(cookie)).user.id;
    await expect(
      env.DB.prepare("UPDATE user_profiles SET display_name = 'ab' WHERE user_id = ?")
        .bind(id)
        .run(),
    ).rejects.toThrow();
    const other = (await me((await signIn(uniqueEmail("db2"))).cookie)).profile
      .displayName as string;
    await expect(
      env.DB.prepare("UPDATE user_profiles SET display_name = ? WHERE user_id = ?")
        .bind(other.toUpperCase(), id)
        .run(),
    ).rejects.toThrow(/UNIQUE/);
  });
  it("deleting an account removes its profile and stats but keeps match history", async () => {
    const { cookie } = await signIn(uniqueEmail("del"));
    const id = (await me(cookie)).user.id;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO matches (match_id, variant, mode, started_at, rules_version) VALUES ('keep-me', 'classic', 'quick', 1, 1)",
      ),
      env.DB.prepare(
        "INSERT INTO match_players (match_id, seat_index, user_id, is_bot) VALUES ('keep-me', 0, ?, 0)",
      ).bind(id),
    ]);
    await env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(id).run();
    expect(
      await env.DB.prepare("SELECT 1 FROM user_profiles WHERE user_id = ?").bind(id).first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT 1 FROM player_stats WHERE user_id = ?").bind(id).first(),
    ).toBeNull();
    const row = await env.DB.prepare(
      "SELECT user_id FROM match_players WHERE match_id = 'keep-me'",
    ).first<{ user_id: string | null }>();
    expect(row?.user_id).toBeNull();
  });
});
