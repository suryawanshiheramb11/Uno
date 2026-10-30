// Fails if our migrations no longer produce the auth tables Better Auth expects.
// Generates the schema with the Better Auth CLI, builds it in memory, builds the migrations tagged
// `*_better_auth*.sql` in memory, and compares the columns of user/session/account/verification.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const out = join(process.env.TMPDIR ?? "/tmp", `uno-auth-schema-${process.pid}.sql`);
execFileSync(
  "npx",
  [
    "--no-install",
    "auth",
    "generate",
    "--config",
    join(here, "auth-schema.config.ts"),
    "--output",
    out,
    "-y",
  ],
  {
    cwd: join(here, ".."),
    stdio: "ignore",
  },
);

const generated = new DatabaseSync(":memory:");
generated.exec(readFileSync(out, "utf8"));
const migrated = new DatabaseSync(":memory:");
const dir = join(here, "..", "migrations");
for (const file of readdirSync(dir)
  .filter((f) => /_better_auth.*\.sql$/.test(f))
  .sort()) {
  migrated.exec(readFileSync(join(dir, file), "utf8"));
}

const shape = (db, table) =>
  db
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .map((c) => `${c.name}:${String(c.type).toLowerCase()}:${c.notnull}:${c.pk}`)
    .sort();
let drift = false;
for (const table of ["user", "session", "account", "verification"]) {
  const a = shape(generated, table).join(", ");
  const b = shape(migrated, table).join(", ");
  if (a !== b) {
    drift = true;
    console.error(`DRIFT in "${table}":\n  Better Auth wants: ${a}\n  migrations give:   ${b}`);
  }
}
if (drift) process.exit(1);
console.log("Auth migrations match Better Auth's schema.");
