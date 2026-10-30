import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../auth/MeContext";

export function Shell({ children, title }: { children: ReactNode; title?: string }) {
  const { state, signOut } = useMe();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface-2">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/dashboard" className="font-display text-2xl text-uno-red">
            UNO
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {state.status === "signedIn" ? (
              <>
                <Link to="/profile" className="text-ink-muted hover:text-ink">
                  {state.me.profile.displayName}
                  {state.me.user.isGuest ? (
                    <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs">
                      Guest
                    </span>
                  ) : null}
                </Link>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="rounded-lg border border-line px-3 py-1 hover:bg-surface"
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link
                to="/sign-in"
                className="rounded-lg bg-uno-blue px-3 py-1 font-semibold text-white"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        {title ? <h1 className="mb-6 text-3xl font-bold">{title}</h1> : null}
        {children}
      </main>
    </div>
  );
}
