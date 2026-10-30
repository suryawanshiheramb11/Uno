-- Holds magic links for automated sign-in tests only. It is written only for addresses on the
-- configured E2E domain AND only when the E2E_SECRET is set (never in production); it is otherwise empty.
CREATE TABLE e2e_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  url        TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX e2e_outbox_email ON e2e_outbox (email, id DESC);
