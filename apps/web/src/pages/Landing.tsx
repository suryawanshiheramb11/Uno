import { Link } from "react-router-dom";
import { STRINGS } from "@uno/shared";
import { StatusPill } from "../components/StatusPill";

export function Landing() {
  const s = STRINGS.en;
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="font-display text-7xl tracking-tight text-uno-red sm:text-8xl">{s.title}</h1>
      <p className="text-lg text-ink-muted">{s.tagline}</p>
      <Link to="/sign-in" className="rounded-xl bg-uno-blue px-6 py-3 font-semibold text-white">
        {s.signIn}
      </Link>
      <StatusPill />
    </main>
  );
}
