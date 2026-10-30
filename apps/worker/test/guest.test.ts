import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call, jsonInit, signIn, signInAsGuest, uniqueEmail } from "./helpers";

const me = async (cookie: string) => {
  const res = await call("/api/me", {}, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as any;
};

describe("guest accounts", () => {
  it("one call creates a guest with an HttpOnly, Secure, SameSite=Lax session cookie", async () => {
    const { setCookies } = await signInAsGuest();
    const session = setCookies.find((c) => c.startsWith("__Secure-uno.session_token="));
    expect(session).toBeDefined();
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/Secure/i);
    expect(session).toMatch(/SameSite=Lax/i);
  });
  it("/api/me reports a guest with a Guest name, a placeholder email and zeroed stats", async () => {
    const body = await me((await signInAsGuest()).cookie);
    expect(body.user.isGuest).toBe(true);
    expect(body.user.email).toMatch(/@guest\.uno\.invalid$/);
    expect(body.profile.displayName).toMatch(/^Guest \d{4}$/);
    expect(body.stats).toMatchObject({ gamesPlayed: 0, wins: 0, elo: 1000 });
  });
  it("a normal account is not a guest", async () => {
    expect((await me((await signIn(uniqueEmail("real"))).cookie)).user.isGuest).toBe(false);
  });
  it("the guest session persists across requests", async () => {
    const { cookie } = await signInAsGuest();
    const first = await me(cookie);
    expect((await me(cookie)).user.id).toBe(first.user.id);
  });
  it("every guest is a separate account", async () => {
    const a = await me((await signInAsGuest()).cookie);
    const b = await me((await signInAsGuest()).cookie);
    expect(a.user.id).not.toBe(b.user.id);
    expect(a.profile.displayName).not.toBe(b.profile.displayName);
  });
  it("a guest can rename themselves and change preferences", async () => {
    const { cookie } = await signInAsGuest();
    const name = `Tester ${Date.now() % 100000}`;
    expect(
      (await call("/api/me/profile", jsonInit("PATCH", { displayName: name }), cookie)).status,
    ).toBe(200);
    expect(
      (await call("/api/me/preferences", jsonInit("PATCH", { theme: "dark" }), cookie)).status,
    ).toBe(200);
    const body = await me(cookie);
    expect(body.profile.displayName).toBe(name);
    expect(body.profile.preferences.theme).toBe("dark");
    expect(body.user.isGuest).toBe(true);
  });
  it("a guest cannot reach another account's data and a spoofed id changes nothing", async () => {
    const user = await signIn(uniqueEmail("owner"));
    const owner = await me(user.cookie);
    const guest = await signInAsGuest();
    const res = await call("/api/me", { headers: { "x-user-id": owner.user.id } }, guest.cookie);
    expect(((await res.json()) as any).user.id).not.toBe(owner.user.id);
  });
  it("signing out ends a guest session", async () => {
    const { cookie } = await signInAsGuest();
    await call("/api/auth/sign-out", jsonInit("POST", {}), cookie);
    expect((await call("/api/me", {}, cookie)).status).toBe(401);
  });

  describe("signing in later keeps the guest's progress", () => {
    const earn = async (guestId: string) => {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE player_stats SET games_played = 5, wins = 3, losses = 2, longest_streak = 3, elo = 1100 WHERE user_id = ?",
        ).bind(guestId),
        env.DB.prepare(
          "INSERT INTO matches (match_id, variant, mode, started_at, ended_at, winner_id, rules_version) VALUES (?, 'no_mercy', 'practice', 500, 900, ?, 1)",
        ).bind(`g-${guestId.slice(0, 8)}`, guestId),
        env.DB.prepare(
          "INSERT INTO match_players (match_id, seat_index, user_id, result, final_hand_size, is_bot) VALUES (?, 0, ?, 'win', 0, 0)",
        ).bind(`g-${guestId.slice(0, 8)}`, guestId),
      ]);
    };

    it("moves match history and stats to the new account and removes the guest", async () => {
      const guest = await signInAsGuest();
      const guestBody = await me(guest.cookie);
      await earn(guestBody.user.id);

      const real = await signIn(uniqueEmail("upgrade"), guest.cookie);
      const body = await me(real.cookie);
      expect(body.user.isGuest).toBe(false);
      expect(body.user.id).not.toBe(guestBody.user.id);
      expect(body.stats).toMatchObject({
        gamesPlayed: 5,
        wins: 3,
        losses: 2,
        longestStreak: 3,
        elo: 1000,
      });
      const matches = ((await (await call("/api/me/matches", {}, real.cookie)).json()) as any)
        .matches;
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ variant: "no_mercy", result: "win", mode: "practice" });
      expect(
        await env.DB.prepare('SELECT 1 FROM "user" WHERE id = ?').bind(guestBody.user.id).first(),
      ).toBeNull();
      expect(
        await env.DB.prepare("SELECT 1 FROM user_profiles WHERE user_id = ?")
          .bind(guestBody.user.id)
          .first(),
      ).toBeNull();
    });
    it("the old guest session stops working", async () => {
      const guest = await signInAsGuest();
      await signIn(uniqueEmail("upgrade2"), guest.cookie);
      expect((await call("/api/me", {}, guest.cookie)).status).toBe(401);
    });
    it("signing in to an account that already has stats adds the guest's results to it", async () => {
      const email = uniqueEmail("existing");
      const first = await signIn(email);
      const id = (await me(first.cookie)).user.id;
      await env.DB.prepare(
        "UPDATE player_stats SET games_played = 10, wins = 4, losses = 6, longest_streak = 2, elo = 1234 WHERE user_id = ?",
      )
        .bind(id)
        .run();
      const guest = await signInAsGuest();
      await earn((await me(guest.cookie)).user.id);
      const again = await signIn(email, guest.cookie);
      const body = await me(again.cookie);
      expect(body.user.id).toBe(id);
      expect(body.stats).toMatchObject({
        gamesPlayed: 15,
        wins: 7,
        losses: 8,
        longestStreak: 3,
        elo: 1234,
      });
    });
  });
});
