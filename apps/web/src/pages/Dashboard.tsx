import { Link } from "react-router-dom";
import { useMe } from "../auth/MeContext";
import { RequireAuth } from "../components/RequireAuth";
import { Shell } from "../components/Shell";

const GAMES = [
  {
    to: "/play/classic",
    label: "Play Classic",
    note: "Private room with friends",
    color: "bg-uno-red",
  },
  {
    to: "/play/no-mercy",
    label: "Play No Mercy",
    note: "Stack, swap, survive",
    color: "bg-uno-blue",
  },
  {
    to: "/play/practice",
    label: "Practice vs bots",
    note: "Learn the rules",
    color: "bg-uno-green",
  },
];

function DashboardInner() {
  const { state } = useMe();
  if (state.status !== "signedIn") return null;
  const { profile, stats } = state.me;
  return (
    <Shell>
      <p className="text-sm text-ink-muted" data-testid="signin-state">
        {state.me.user.isGuest ? "Guest" : "Signed in"}
      </p>
      <h1 className="mb-6 text-3xl font-bold">Welcome back, {profile.displayName}</h1>
      {state.me.user.isGuest ? (
        <aside
          aria-label="Guest account"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-uno-yellow bg-surface-2 p-4"
        >
          <p className="text-sm">
            You&apos;re playing as a guest. Sign in to keep your games, stats and settings on any
            device.
          </p>
          <Link
            to="/sign-in"
            className="rounded-lg bg-uno-blue px-3 py-2 text-sm font-semibold text-white"
          >
            Sign in to save progress
          </Link>
        </aside>
      ) : null}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Games", stats.gamesPlayed],
          ["Wins", stats.wins],
          ["Streak", stats.currentStreak],
          ["Rating", stats.elo],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-surface-2 p-4 text-center">
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {GAMES.map((g) => (
          <Link
            key={g.to}
            to={g.to}
            className={`${g.color} rounded-2xl p-5 text-white shadow-sm hover:opacity-95`}
          >
            <div className="text-lg font-bold">{g.label}</div>
            <div className="text-sm opacity-90">{g.note}</div>
            <div className="mt-3 text-xs uppercase tracking-wide opacity-80">Coming soon</div>
          </Link>
        ))}
      </div>
    </Shell>
  );
}

export function Dashboard() {
  return (
    <RequireAuth>
      <DashboardInner />
    </RequireAuth>
  );
}
