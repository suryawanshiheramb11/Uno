/** Profile, preferences and /api/me shapes shared by the Worker and the web app. */

export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 20;

export type Validation<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * 3-20 characters, letters, digits and spaces only. Surrounding space is trimmed and runs of spaces
 * collapse to one; the returned value is what gets stored.
 */
export function validateDisplayName(input: unknown): Validation<string> {
  if (typeof input !== "string") return { ok: false, message: "Display name must be text." };
  const value = input.trim().replace(/ +/g, " ");
  if (!/^[A-Za-z0-9 ]*$/.test(value)) {
    return { ok: false, message: "Display name may only contain letters, numbers and spaces." };
  }
  if (value.length < DISPLAY_NAME_MIN || value.length > DISPLAY_NAME_MAX) {
    return {
      ok: false,
      message: `Display name must be ${DISPLAY_NAME_MIN}-${DISPLAY_NAME_MAX} characters.`,
    };
  }
  return { ok: true, value };
}

export function validateAvatarSeed(input: unknown): Validation<string> {
  if (typeof input !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(input)) {
    return { ok: false, message: "Avatar seed must be 1-32 letters, numbers, - or _." };
  }
  return { ok: true, value: input };
}

// ---------------------------------------------------------------- preferences

export const COLORBLIND_PALETTES = ["off", "shapes", "high-contrast"] as const;
export const REDUCED_MOTION = ["system", "on", "off"] as const;
export const THEMES = ["system", "light", "dark"] as const;

export interface Preferences {
  soundEffects: boolean;
  soundMusic: boolean;
  /** 0-100 */
  musicVolume: number;
  colorblindPalette: (typeof COLORBLIND_PALETTES)[number];
  reducedMotion: (typeof REDUCED_MOTION)[number];
  theme: (typeof THEMES)[number];
  /** BCP 47 language tag, e.g. "en" or "pt-BR". */
  locale: string;
  hasCompletedOnboarding: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  soundEffects: true,
  soundMusic: true,
  musicVolume: 60,
  colorblindPalette: "off",
  reducedMotion: "system",
  theme: "system",
  locale: "en",
  hasCompletedOnboarding: false,
};

type Rule = (v: unknown) => boolean;
const oneOf =
  (list: readonly string[]): Rule =>
  (v) =>
    typeof v === "string" && list.includes(v);

const PREFERENCE_RULES: Record<keyof Preferences, Rule> = {
  soundEffects: (v) => typeof v === "boolean",
  soundMusic: (v) => typeof v === "boolean",
  musicVolume: (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100,
  colorblindPalette: oneOf(COLORBLIND_PALETTES),
  reducedMotion: oneOf(REDUCED_MOTION),
  theme: oneOf(THEMES),
  locale: (v) => typeof v === "string" && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(v),
  hasCompletedOnboarding: (v) => typeof v === "boolean",
};

/** A partial update: known keys with valid values only. Anything else is rejected, never ignored. */
export function validatePreferencesPatch(input: unknown): Validation<Partial<Preferences>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, message: "Preferences must be an object." };
  }
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const rule = PREFERENCE_RULES[key as keyof Preferences];
    if (!rule) return { ok: false, message: `Unknown preference: ${key}` };
    if (!rule(value)) return { ok: false, message: `Invalid value for ${key}.` };
    patch[key] = value;
  }
  if (Object.keys(patch).length === 0) return { ok: false, message: "No preferences provided." };
  return { ok: true, value: patch as Partial<Preferences> };
}

/** Stored JSON -> full preferences: defaults fill any key that is missing or no longer valid. */
export function resolvePreferences(stored: unknown): Preferences {
  const out: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
  if (typeof stored === "object" && stored !== null && !Array.isArray(stored)) {
    for (const [key, value] of Object.entries(stored)) {
      const rule = PREFERENCE_RULES[key as keyof Preferences];
      if (rule?.(value)) out[key] = value;
    }
  }
  return out as unknown as Preferences;
}

// ---------------------------------------------------------------- API shapes

export interface Profile {
  displayName: string;
  avatarSeed: string;
  preferences: Preferences;
  createdAt: number;
  updatedAt: number;
}

export interface Stats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  currentStreak: number;
  longestStreak: number;
  elo: number;
  lastUpdated: number;
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    /** A one-click guest account (no email). Progress carries over if they sign in later. */
    isGuest: boolean;
  };
  profile: Profile;
  stats: Stats;
}

export interface MatchSummaryRow {
  matchId: string;
  variant: "classic" | "no_mercy";
  mode: "private" | "quick" | "practice" | "ranked";
  startedAt: number;
  endedAt: number | null;
  winnerId: string | null;
  seatIndex: number;
  result: "win" | "loss" | "forfeit" | "abandoned" | null;
  finalHandSize: number | null;
}

export interface MatchesResponse {
  matches: MatchSummaryRow[];
}
