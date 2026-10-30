import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useMe } from "../auth/MeContext";

/** Shows children only to signed-in users; everyone else is sent to the sign-in page. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useMe();
  const location = useLocation();
  if (state.status === "loading") return <p className="p-8 text-center text-ink-muted">Loading…</p>;
  if (state.status === "error")
    return (
      <p className="p-8 text-center text-uno-red" role="alert">
        {state.message}
      </p>
    );
  if (state.status === "anonymous")
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
