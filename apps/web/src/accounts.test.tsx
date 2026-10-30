import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DEFAULT_PREFERENCES, type MeResponse } from "@uno/shared";
import { App } from "./App";
import { applyPreferences, MeProvider } from "./auth/MeContext";

const social = vi.fn();
const magicLink = vi.fn();
const anonymous = vi.fn();
const signOut = vi.fn();
vi.mock("./auth/client", () => ({
  authClient: {
    signIn: {
      social: (...a: unknown[]) => social(...a),
      magicLink: (...a: unknown[]) => magicLink(...a),
      anonymous: (...a: unknown[]) => anonymous(...a),
    },
    signOut: (...a: unknown[]) => signOut(...a),
  },
}));

const ME: MeResponse = {
  user: { id: "u1", email: "ada@example.com", emailVerified: true, image: null, isGuest: false },
  profile: {
    displayName: "Ada Lovelace",
    avatarSeed: "ada",
    preferences: { ...DEFAULT_PREFERENCES },
    createdAt: 1,
    updatedAt: 1,
  },
  stats: {
    gamesPlayed: 12,
    wins: 7,
    losses: 5,
    currentStreak: 2,
    longestStreak: 4,
    elo: 1042,
    lastUpdated: 1,
  },
};

type Route = (init?: RequestInit) => Response | Promise<Response>;
function mockApi(routes: Record<string, Route>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const route = routes[key];
    if (!route) throw new Error(`unmocked request: ${key}`);
    return route(init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const ok = (body: unknown) => new Response(JSON.stringify(body));
const fail = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), { status });

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MeProvider>
        <App />
      </MeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  social.mockResolvedValue({ data: {}, error: null });
  magicLink.mockResolvedValue({ data: {}, error: null });
  anonymous.mockResolvedValue({ data: {}, error: null });
  signOut.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("sign-in page", () => {
  const signedOut = { "GET /api/me": () => fail(401, "ERR_UNAUTHORIZED", "Sign in required.") };

  it("offers Google and an email field", async () => {
    mockApi(signedOut);
    renderApp("/sign-in");
    expect(await screen.findByRole("button", { name: /Continue with Google/ })).toBeTruthy();
    expect(screen.getByLabelText("Email address")).toBeTruthy();
  });
  it("starts Google sign-in and returns to the dashboard", async () => {
    mockApi(signedOut);
    renderApp("/sign-in");
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));
    await waitFor(() =>
      expect(social).toHaveBeenCalledWith({ provider: "google", callbackURL: "/dashboard" }),
    );
  });
  it("emails a magic link and confirms", async () => {
    mockApi(signedOut);
    renderApp("/sign-in");
    fireEvent.change(await screen.findByLabelText("Email address"), {
      target: { value: " ada@example.com " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    await waitFor(() =>
      expect(magicLink).toHaveBeenCalledWith({
        email: "ada@example.com",
        callbackURL: "/dashboard",
      }),
    );
    expect((await screen.findByRole("status")).textContent).toContain("ada@example.com");
  });
  it("shows an error when the link cannot be sent", async () => {
    magicLink.mockResolvedValue({ data: null, error: { message: "Too many attempts" } });
    mockApi(signedOut);
    renderApp("/sign-in");
    fireEvent.change(await screen.findByLabelText("Email address"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Too many attempts");
  });
  it("keeps the send button disabled until an address is typed", async () => {
    mockApi(signedOut);
    renderApp("/sign-in");
    expect(
      (
        (await screen.findByRole("button", {
          name: "Email me a sign-in link",
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("sends an already signed-in visitor to the dashboard", async () => {
    mockApi({ "GET /api/me": () => ok(ME) });
    renderApp("/sign-in");
    expect(await screen.findByText(/Welcome back, Ada Lovelace/)).toBeTruthy();
  });
});

describe("dashboard", () => {
  it("redirects signed-out visitors to sign in", async () => {
    mockApi({ "GET /api/me": () => fail(401, "ERR_UNAUTHORIZED", "Sign in required.") });
    renderApp("/dashboard");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
  });
  it("shows the signed-in state, stats and the placeholder game routes", async () => {
    mockApi({ "GET /api/me": () => ok(ME) });
    renderApp("/dashboard");
    expect(await screen.findByText(/Welcome back, Ada Lovelace/)).toBeTruthy();
    expect(screen.getByTestId("signin-state").textContent).toBe("Signed in");
    expect(screen.getByText("1042")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Play Classic/ }).getAttribute("href")).toBe(
      "/play/classic",
    );
    expect(screen.getByRole("link", { name: /Play No Mercy/ }).getAttribute("href")).toBe(
      "/play/no-mercy",
    );
    expect(screen.getByRole("link", { name: /Practice vs bots/ }).getAttribute("href")).toBe(
      "/play/practice",
    );
  });
  it("the placeholder game routes exist for signed-in players", async () => {
    mockApi({ "GET /api/me": () => ok(ME) });
    renderApp("/play/no-mercy");
    expect(await screen.findByRole("heading", { name: "No Mercy" })).toBeTruthy();
  });
  it("signing out returns to the signed-out state", async () => {
    mockApi({ "GET /api/me": () => ok(ME) });
    renderApp("/dashboard");
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
  });
  it("shows an error, not a blank page, when the server is down", async () => {
    mockApi({
      "GET /api/me": () => {
        throw new Error("offline");
      },
    });
    renderApp("/dashboard");
    expect((await screen.findByRole("alert")).textContent).toContain("Could not reach the server");
  });
});

describe("profile page", () => {
  const withProfile = (extra: Record<string, Route> = {}) =>
    mockApi({ "GET /api/me": () => ok(ME), ...extra });

  it("shows the current name and statistics (read-only)", async () => {
    withProfile();
    renderApp("/profile");
    expect(((await screen.findByLabelText("Display name")) as HTMLInputElement).value).toBe(
      "Ada Lovelace",
    );
    const stats = screen.getByRole("region", { name: "Statistics" });
    expect(stats.textContent).toContain("1042");
    expect(stats.querySelector("input")).toBeNull();
  });
  it("flags an invalid name and blocks saving", async () => {
    withProfile();
    renderApp("/profile");
    const input = await screen.findByLabelText("Display name");
    fireEvent.change(input, { target: { value: "No!" } });
    expect(
      screen.getByText(/only contain letters, numbers and spaces|3-20 characters/),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save profile" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it("saves a new name", async () => {
    const patch = vi.fn((init?: RequestInit) =>
      ok({ profile: { ...ME.profile, displayName: JSON.parse(String(init?.body)).displayName } }),
    );
    withProfile({ "PATCH /api/me/profile": patch });
    renderApp("/profile");
    fireEvent.change(await screen.findByLabelText("Display name"), {
      target: { value: "  Grace   Hopper " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect((await screen.findByText("Saved.")).textContent).toBe("Saved.");
    expect(JSON.parse(String(patch.mock.calls[0]?.[0]?.body))).toMatchObject({
      displayName: "Grace Hopper",
    });
    expect(((await screen.findByLabelText("Display name")) as HTMLInputElement).value).toBe(
      "Grace Hopper",
    );
  });
  it("tells the player when the name is taken (409)", async () => {
    withProfile({
      "PATCH /api/me/profile": () =>
        fail(409, "ERR_CONFLICT", "That display name is already taken."),
    });
    renderApp("/profile");
    fireEvent.change(await screen.findByLabelText("Display name"), {
      target: { value: "Taken Name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already taken");
  });
  it("saves preferences and applies the theme", async () => {
    const patch = vi.fn((init?: RequestInit) =>
      ok({ preferences: { ...DEFAULT_PREFERENCES, ...JSON.parse(String(init?.body)) } }),
    );
    withProfile({ "PATCH /api/me/preferences": patch });
    renderApp("/profile");
    fireEvent.change(await screen.findByLabelText("Theme"), { target: { value: "dark" } });
    fireEvent.change(screen.getByLabelText(/Music volume/), { target: { value: "20" } });
    fireEvent.click(screen.getByLabelText("Sound effects"));
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    expect((await screen.findByText("Preferences saved.")).textContent).toBe("Preferences saved.");
    expect(JSON.parse(String(patch.mock.calls[0]?.[0]?.body))).toMatchObject({
      theme: "dark",
      musicVolume: 20,
      soundEffects: false,
    });
    await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));
  });
  it("sends signed-out visitors to sign in", async () => {
    mockApi({ "GET /api/me": () => fail(401, "ERR_UNAUTHORIZED", "Sign in required.") });
    renderApp("/profile");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
  });
});

describe("applyPreferences", () => {
  it("reflects theme, palette, motion and language on the root element", () => {
    const root = document.createElement("html");
    applyPreferences(
      {
        ...DEFAULT_PREFERENCES,
        theme: "light",
        colorblindPalette: "shapes",
        reducedMotion: "on",
        locale: "pt-BR",
      },
      root,
    );
    expect([
      root.getAttribute("data-theme"),
      root.getAttribute("data-palette"),
      root.getAttribute("data-motion"),
      root.lang,
    ]).toEqual(["light", "shapes", "on", "pt-BR"]);
  });
  it("lets the system decide when the theme is 'system'", () => {
    const root = document.createElement("html");
    root.setAttribute("data-theme", "dark");
    applyPreferences({ ...DEFAULT_PREFERENCES, theme: "system" }, root);
    expect(root.hasAttribute("data-theme")).toBe(false);
  });
});

describe("guest accounts", () => {
  const GUEST: MeResponse = {
    ...ME,
    user: {
      id: "g1",
      email: "x@guest.uno.invalid",
      emailVerified: false,
      image: null,
      isGuest: true,
    },
    profile: { ...ME.profile, displayName: "Guest 4821" },
  };

  it("offers a one-click guest option on the sign-in page", async () => {
    mockApi({ "GET /api/me": () => fail(401, "ERR_UNAUTHORIZED", "Sign in required.") });
    renderApp("/sign-in");
    expect(await screen.findByRole("button", { name: "Continue as guest" })).toBeTruthy();
  });
  it("starts a guest session and lands on the dashboard", async () => {
    let started = false;
    anonymous.mockImplementation(async () => {
      started = true;
      return { data: {}, error: null };
    });
    mockApi({
      "GET /api/me": () =>
        started ? ok(GUEST) : fail(401, "ERR_UNAUTHORIZED", "Sign in required."),
    });
    renderApp("/sign-in");
    fireEvent.click(await screen.findByRole("button", { name: "Continue as guest" }));
    expect(await screen.findByText(/Welcome back, Guest 4821/)).toBeTruthy();
    expect(anonymous).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("signin-state").textContent).toBe("Guest");
  });
  it("tells a guest they can sign in to keep their progress", async () => {
    mockApi({ "GET /api/me": () => ok(GUEST) });
    renderApp("/dashboard");
    const banner = await screen.findByLabelText("Guest account");
    expect(banner.textContent).toContain("playing as a guest");
    expect(
      screen.getByRole("link", { name: "Sign in to save progress" }).getAttribute("href"),
    ).toBe("/sign-in");
    expect(screen.getAllByText("Guest").length).toBeGreaterThan(0);
  });
  it("shows no guest banner to a real account", async () => {
    mockApi({ "GET /api/me": () => ok(ME) });
    renderApp("/dashboard");
    await screen.findByText(/Welcome back, Ada Lovelace/);
    expect(screen.queryByLabelText("Guest account")).toBeNull();
  });
  it("keeps a signed-in guest on the sign-in page so they can upgrade, without offering guest again", async () => {
    mockApi({ "GET /api/me": () => ok(GUEST) });
    renderApp("/sign-in");
    expect(await screen.findByRole("button", { name: /Continue with Google/ })).toBeTruthy();
    expect(screen.getByText(/You're playing as a guest/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue as guest" })).toBeNull();
  });
  it("shows an error if the guest session cannot be started", async () => {
    anonymous.mockResolvedValue({ data: null, error: { message: "Guest sign-in is unavailable" } });
    mockApi({ "GET /api/me": () => fail(401, "ERR_UNAUTHORIZED", "Sign in required.") });
    renderApp("/sign-in");
    fireEvent.click(await screen.findByRole("button", { name: "Continue as guest" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Guest sign-in is unavailable",
    );
  });
});
