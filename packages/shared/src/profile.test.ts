import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  resolvePreferences,
  validateAvatarSeed,
  validateDisplayName,
  validatePreferencesPatch,
} from "./profile";

describe("validateDisplayName", () => {
  it.each(["Ada", "Ada Lovelace", "A1b", "x".repeat(20), "Player 42"])("accepts %j", (name) => {
    expect(validateDisplayName(name)).toEqual({ ok: true, value: name });
  });
  it("trims and collapses spaces", () => {
    expect(validateDisplayName("  Ada    Lovelace  ")).toEqual({ ok: true, value: "Ada Lovelace" });
  });
  it.each(["ab", "", "  ", "x".repeat(21)])("rejects bad length %j", (name) => {
    expect(validateDisplayName(name).ok).toBe(false);
  });
  it.each(["Ada!", "Ada_B", "Ada-B", "a@b", "émile", "<b>hi</b>", "Ada\nB"])(
    "rejects characters in %j",
    (name) => {
      expect(validateDisplayName(name).ok).toBe(false);
    },
  );
  it.each([null, undefined, 42, {}, ["Ada"]])("rejects non-string %j", (v) => {
    expect(validateDisplayName(v).ok).toBe(false);
  });
});

describe("validateAvatarSeed", () => {
  it("accepts short safe seeds", () =>
    expect(validateAvatarSeed("abc-123_X")).toEqual({ ok: true, value: "abc-123_X" }));
  it.each(["", "a b", "x".repeat(33), "a/b", 5])("rejects %j", (v) =>
    expect(validateAvatarSeed(v).ok).toBe(false),
  );
});

describe("preferences", () => {
  it("defaults cover every setting in the brief", () => {
    expect(Object.keys(DEFAULT_PREFERENCES).sort()).toEqual(
      [
        "colorblindPalette",
        "hasCompletedOnboarding",
        "locale",
        "musicVolume",
        "reducedMotion",
        "soundEffects",
        "soundMusic",
        "theme",
      ].sort(),
    );
  });
  it("accepts a valid partial patch", () => {
    expect(validatePreferencesPatch({ theme: "dark", musicVolume: 10 })).toEqual({
      ok: true,
      value: { theme: "dark", musicVolume: 10 },
    });
  });
  it("rejects unknown keys instead of ignoring them", () => {
    expect(validatePreferencesPatch({ theme: "dark", elo: 3000 })).toEqual({
      ok: false,
      message: "Unknown preference: elo",
    });
  });
  it.each([
    { theme: "neon" },
    { musicVolume: 101 },
    { musicVolume: -1 },
    { musicVolume: 5.5 },
    { musicVolume: "10" },
    { soundEffects: "yes" },
    { locale: "english" },
    { colorblindPalette: "rainbow" },
    { reducedMotion: true },
  ])("rejects invalid value %j", (patch) => {
    expect(validatePreferencesPatch(patch).ok).toBe(false);
  });
  it.each([null, [], "x", 3, {}])("rejects a non-object or empty patch %j", (v) => {
    expect(validatePreferencesPatch(v).ok).toBe(false);
  });
  it("resolvePreferences fills defaults and drops invalid stored values", () => {
    expect(resolvePreferences({ theme: "dark", musicVolume: 999, junk: 1 })).toEqual({
      ...DEFAULT_PREFERENCES,
      theme: "dark",
    });
    expect(resolvePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(resolvePreferences("garbage")).toEqual(DEFAULT_PREFERENCES);
  });
});
