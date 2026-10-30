import { useEffect, useState } from "react";
import { STRINGS } from "@uno/shared";
import type { HealthResponse } from "@uno/shared";

type Status = { kind: "checking" } | { kind: "offline" } | { kind: "ok"; health: HealthResponse };

export function StatusPill() {
  const [status, setStatus] = useState<Status>({ kind: "checking" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((r) =>
        r.ok ? (r.json() as Promise<HealthResponse>) : Promise.reject(new Error(String(r.status))),
      )
      .then((health) => setStatus({ kind: "ok", health }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) setStatus({ kind: "offline" });
      });
    return () => controller.abort();
  }, []);

  const s = STRINGS.en;
  const label =
    status.kind === "checking"
      ? s.statusChecking
      : status.kind === "offline"
        ? s.statusOffline
        : status.health.environment;
  const dot =
    status.kind === "ok"
      ? "bg-uno-green"
      : status.kind === "offline"
        ? "bg-uno-red"
        : "bg-uno-yellow";

  return (
    <span
      role="status"
      data-testid="status-pill"
      className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1 text-sm text-ink-muted"
    >
      <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
