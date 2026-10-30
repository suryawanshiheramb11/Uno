import { useState, type FormEvent } from "react";
import {
  COLORBLIND_PALETTES,
  REDUCED_MOTION,
  THEMES,
  validateAvatarSeed,
  validateDisplayName,
  type MeResponse,
  type Preferences,
} from "@uno/shared";
import { api, ApiError } from "../api";
import { useMe } from "../auth/MeContext";
import { Avatar } from "../components/Avatar";
import { RequireAuth } from "../components/RequireAuth";
import { Shell } from "../components/Shell";

type Notice = { kind: "ok" | "error"; text: string } | null;

const randomSeed = () => Math.random().toString(36).slice(2, 12);

function ProfileForm({ me }: { me: MeResponse }) {
  const { setProfile, setPreferences } = useMe();
  const { profile, stats } = me;

  const [name, setName] = useState(profile.displayName);
  const [seed, setSeed] = useState(profile.avatarSeed);
  const [identityNotice, setIdentityNotice] = useState<Notice>(null);
  const [prefs, setPrefs] = useState<Preferences>(profile.preferences);
  const [prefsNotice, setPrefsNotice] = useState<Notice>(null);

  const nameCheck = validateDisplayName(name);
  const seedCheck = validateAvatarSeed(seed);

  async function saveIdentity(e: FormEvent) {
    e.preventDefault();
    if (!nameCheck.ok || !seedCheck.ok) return;
    setIdentityNotice(null);
    try {
      const { profile: updated } = await api.updateProfile({
        displayName: nameCheck.value,
        avatarSeed: seedCheck.value,
      });
      setProfile(updated);
      setName(updated.displayName);
      setIdentityNotice({ kind: "ok", text: "Saved." });
    } catch (err) {
      const taken = err instanceof ApiError && err.status === 409;
      setIdentityNotice({
        kind: "error",
        text: taken
          ? "That name is already taken. Try another."
          : err instanceof Error
            ? err.message
            : "Could not save.",
      });
    }
  }

  async function savePrefs(e: FormEvent) {
    e.preventDefault();
    setPrefsNotice(null);
    try {
      const { preferences } = await api.updatePreferences(prefs);
      setPreferences(preferences);
      setPrefs(preferences);
      setPrefsNotice({ kind: "ok", text: "Preferences saved." });
    } catch (err) {
      setPrefsNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not save.",
      });
    }
  }

  const setPref = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setPrefs((p) => ({ ...p, [key]: value }));
  const fieldClass = "w-full rounded-xl border border-line bg-surface px-3 py-2";

  return (
    <Shell title="Your profile">
      <form
        onSubmit={(e) => void saveIdentity(e)}
        className="mb-8 rounded-2xl border border-line bg-surface-2 p-6"
        aria-label="Identity"
      >
        <div className="mb-4 flex items-center gap-4">
          <Avatar seed={seedCheck.ok ? seedCheck.value : profile.avatarSeed} />
          <button
            type="button"
            onClick={() => setSeed(randomSeed())}
            className="rounded-lg border border-line px-3 py-1 text-sm hover:bg-surface"
          >
            New avatar
          </button>
        </div>
        <label htmlFor="displayName" className="mb-1 block text-sm font-medium">
          Display name
        </label>
        <input
          id="displayName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={fieldClass}
          maxLength={40}
          aria-invalid={!nameCheck.ok}
          aria-describedby="nameHelp"
        />
        <p
          id="nameHelp"
          className={`mt-1 text-xs ${nameCheck.ok ? "text-ink-muted" : "text-uno-red"}`}
        >
          {nameCheck.ok ? "3-20 letters, numbers and spaces." : nameCheck.message}
        </p>
        <button
          type="submit"
          disabled={!nameCheck.ok || !seedCheck.ok}
          className="mt-4 rounded-xl bg-uno-blue px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          Save profile
        </button>
        {identityNotice ? (
          <p
            role={identityNotice.kind === "error" ? "alert" : "status"}
            className={`mt-3 text-sm ${identityNotice.kind === "error" ? "text-uno-red" : "text-uno-green"}`}
          >
            {identityNotice.text}
          </p>
        ) : null}
      </form>

      <form
        onSubmit={(e) => void savePrefs(e)}
        className="mb-8 space-y-4 rounded-2xl border border-line bg-surface-2 p-6"
        aria-label="Preferences"
      >
        <h2 className="text-lg font-bold">Preferences</h2>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={prefs.soundEffects}
            onChange={(e) => setPref("soundEffects", e.target.checked)}
          />{" "}
          Sound effects
        </label>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={prefs.soundMusic}
            onChange={(e) => setPref("soundMusic", e.target.checked)}
          />{" "}
          Music
        </label>
        <div>
          <label htmlFor="volume" className="mb-1 block text-sm font-medium">
            Music volume: {prefs.musicVolume}
          </label>
          <input
            id="volume"
            type="range"
            min={0}
            max={100}
            step={1}
            value={prefs.musicVolume}
            onChange={(e) => setPref("musicVolume", Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="theme" className="mb-1 block text-sm font-medium">
              Theme
            </label>
            <select
              id="theme"
              value={prefs.theme}
              onChange={(e) => setPref("theme", e.target.value as Preferences["theme"])}
              className={fieldClass}
            >
              {THEMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="palette" className="mb-1 block text-sm font-medium">
              Colour-blind palette
            </label>
            <select
              id="palette"
              value={prefs.colorblindPalette}
              onChange={(e) =>
                setPref("colorblindPalette", e.target.value as Preferences["colorblindPalette"])
              }
              className={fieldClass}
            >
              {COLORBLIND_PALETTES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="motion" className="mb-1 block text-sm font-medium">
              Reduced motion
            </label>
            <select
              id="motion"
              value={prefs.reducedMotion}
              onChange={(e) =>
                setPref("reducedMotion", e.target.value as Preferences["reducedMotion"])
              }
              className={fieldClass}
            >
              {REDUCED_MOTION.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="locale" className="mb-1 block text-sm font-medium">
            Language
          </label>
          <select
            id="locale"
            value={prefs.locale}
            onChange={(e) => setPref("locale", e.target.value)}
            className={fieldClass}
          >
            <option value="en">English</option>
          </select>
        </div>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={prefs.hasCompletedOnboarding}
            onChange={(e) => setPref("hasCompletedOnboarding", e.target.checked)}
          />{" "}
          I&apos;ve completed the tutorial
        </label>
        <button type="submit" className="rounded-xl bg-uno-blue px-4 py-2 font-semibold text-white">
          Save preferences
        </button>
        {prefsNotice ? (
          <p
            role={prefsNotice.kind === "error" ? "alert" : "status"}
            className={`text-sm ${prefsNotice.kind === "error" ? "text-uno-red" : "text-uno-green"}`}
          >
            {prefsNotice.text}
          </p>
        ) : null}
      </form>

      <section className="rounded-2xl border border-line bg-surface-2 p-6" aria-label="Statistics">
        <h2 className="mb-3 text-lg font-bold">Statistics</h2>
        <p className="mb-3 text-xs text-ink-muted">
          Earned by playing; these can&apos;t be edited.
        </p>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          {[
            ["Games played", stats.gamesPlayed],
            ["Wins", stats.wins],
            ["Losses", stats.losses],
            ["Current streak", stats.currentStreak],
            ["Longest streak", stats.longestStreak],
            ["Rating", stats.elo],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-lg font-bold">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </Shell>
  );
}

function ProfileInner() {
  const { state } = useMe();
  return state.status === "signedIn" ? <ProfileForm me={state.me} /> : null;
}

export function Profile() {
  return (
    <RequireAuth>
      <ProfileInner />
    </RequireAuth>
  );
}
