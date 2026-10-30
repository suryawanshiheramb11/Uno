import { Link } from "react-router-dom";
import { RequireAuth } from "../components/RequireAuth";
import { Shell } from "../components/Shell";

export function ComingSoon({ title }: { title: string }) {
  return (
    <RequireAuth>
      <Shell title={title}>
        <p className="mb-4 text-ink-muted">
          This game mode isn&apos;t playable yet. The rules engine is ready; rooms and the table
          come next.
        </p>
        <Link to="/dashboard" className="text-uno-blue underline">
          Back to the dashboard
        </Link>
      </Shell>
    </RequireAuth>
  );
}
