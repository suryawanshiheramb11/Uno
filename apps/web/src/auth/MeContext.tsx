import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MeResponse, Preferences, Profile } from "@uno/shared";
import { api, ApiError } from "../api";
import { authClient } from "./client";

export type MeState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "signedIn"; me: MeResponse }
  | { status: "error"; message: string };

interface MeContextValue {
  state: MeState;
  refresh: () => Promise<void>;
  setProfile: (profile: Profile) => void;
  setPreferences: (preferences: Preferences) => void;
  signOut: () => Promise<void>;
}

const MeContext = createContext<MeContextValue | null>(null);

/** Reflect the saved preferences on <html> so CSS (and the colour-blind palette) can react. */
export function applyPreferences(
  prefs: Preferences,
  root: HTMLElement = document.documentElement,
): void {
  if (prefs.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", prefs.theme);
  root.setAttribute("data-palette", prefs.colorblindPalette);
  root.setAttribute("data-motion", prefs.reducedMotion);
  root.lang = prefs.locale;
}

export function MeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MeState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setState({ status: "signedIn", me });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState({ status: "anonymous" });
      else
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "Something went wrong.",
        });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (state.status === "signedIn") applyPreferences(state.me.profile.preferences);
  }, [state]);

  const value = useMemo<MeContextValue>(
    () => ({
      state,
      refresh,
      setProfile: (profile) =>
        setState((s) =>
          s.status === "signedIn" ? { status: "signedIn", me: { ...s.me, profile } } : s,
        ),
      setPreferences: (preferences) =>
        setState((s) =>
          s.status === "signedIn"
            ? { status: "signedIn", me: { ...s.me, profile: { ...s.me.profile, preferences } } }
            : s,
        ),
      signOut: async () => {
        await authClient.signOut();
        document.documentElement.removeAttribute("data-theme");
        setState({ status: "anonymous" });
      },
    }),
    [state, refresh],
  );
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export function useMe(): MeContextValue {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe must be used inside <MeProvider>");
  return ctx;
}
