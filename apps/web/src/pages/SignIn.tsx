import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { authClient } from "../auth/client";
import { useMe } from "../auth/MeContext";
import { Shell } from "../components/Shell";

const CALLBACK = "/dashboard";

export function SignIn() {
  const { state, refresh } = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGuest = state.status === "signedIn" && state.me.user.isGuest;
  // A guest stays on this page so they can sign in and keep their progress; everyone else is sent on.
  if (state.status === "signedIn" && !isGuest) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? CALLBACK} replace />;
  }

  async function google() {
    setError(null);
    setBusy(true);
    const { error } = await authClient.signIn.social({ provider: "google", callbackURL: CALLBACK });
    if (error) {
      setError(error.message ?? "Google sign-in is unavailable right now.");
      setBusy(false);
    }
  }

  async function guest() {
    setError(null);
    setBusy(true);
    const { error } = await authClient.signIn.anonymous();
    if (error) {
      setError(error.message ?? "Could not start a guest session. Try again.");
      setBusy(false);
      return;
    }
    await refresh();
    navigate(CALLBACK, { replace: true });
  }

  async function magic(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await authClient.signIn.magicLink({
      email: email.trim(),
      callbackURL: CALLBACK,
    });
    setBusy(false);
    if (error)
      setError(error.message ?? "Could not send the link. Check the address and try again.");
    else setSent(true);
  }

  return (
    <Shell>
      <section className="mx-auto max-w-sm rounded-2xl border border-line bg-surface-2 p-6 shadow-sm">
        <h1 className="mb-1 text-2xl font-bold">Sign in</h1>
        <p className="mb-6 text-sm text-ink-muted">
          {isGuest
            ? "You're playing as a guest. Sign in and your games and stats come with you."
            : "Pick up your games, stats and settings anywhere."}
        </p>

        <button
          type="button"
          onClick={() => void google()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-line bg-white px-4 py-3 font-semibold text-black hover:bg-gray-50 disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#EA4335"
              d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.2 13.6 17.6 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"
            />
            <path
              fill="#FBBC05"
              d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.9-4.7l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.8-6.1z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.4 0-11.8-4.1-13.6-9.9l-7.8 6.1C6.5 42.6 14.6 48 24 48z"
            />
          </svg>
          Continue with Google
        </button>

        <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-ink-muted">
          <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
        </div>

        {sent ? (
          <p role="status" className="rounded-xl bg-surface p-4 text-sm">
            Check your inbox: we sent a sign-in link to <strong>{email}</strong>. It works once and
            expires in 10 minutes.
          </p>
        ) : (
          <form onSubmit={(e) => void magic(e)} className="space-y-3">
            <label className="block text-sm font-medium" htmlFor="email">
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-line bg-surface px-3 py-2"
            />
            <button
              type="submit"
              disabled={busy || email.trim() === ""}
              className="w-full rounded-xl bg-uno-blue px-4 py-3 font-semibold text-white disabled:opacity-60"
            >
              Email me a sign-in link
            </button>
          </form>
        )}
        {isGuest ? null : (
          <>
            <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-ink-muted">
              <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
            </div>
            <button
              type="button"
              onClick={() => void guest()}
              disabled={busy}
              className="w-full rounded-xl border border-line px-4 py-3 font-semibold hover:bg-surface disabled:opacity-60"
            >
              Continue as guest
            </button>
            <p className="mt-2 text-center text-xs text-ink-muted">
              No account needed. Sign in later and keep your progress.
            </p>
          </>
        )}
        {error ? (
          <p role="alert" className="mt-4 text-sm text-uno-red">
            {error}
          </p>
        ) : null}
      </section>
    </Shell>
  );
}
