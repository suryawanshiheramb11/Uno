-- Application tables. Better Auth owns user/session/account/verification (0001); these reference "user"("id").
-- Timestamps are Unix epoch milliseconds.

CREATE TABLE user_profiles (
  user_id          TEXT PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  display_name     TEXT NOT NULL CHECK (length(display_name) BETWEEN 3 AND 20),
  avatar_seed      TEXT NOT NULL CHECK (length(avatar_seed) BETWEEN 1 AND 32),
  preferences_json TEXT NOT NULL DEFAULT '{}',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
-- Names are unique ignoring case: "Alice" and "alice" collide.
CREATE UNIQUE INDEX user_profiles_display_name_nocase ON user_profiles (display_name COLLATE NOCASE);

CREATE TABLE matches (
  match_id        TEXT PRIMARY KEY,
  variant         TEXT NOT NULL CHECK (variant IN ('classic', 'no_mercy')),
  mode            TEXT NOT NULL CHECK (mode IN ('private', 'quick', 'practice', 'ranked')),
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  winner_id       TEXT,
  rules_version   INTEGER NOT NULL,
  event_log_blob  BLOB
);
CREATE INDEX matches_started_at ON matches (started_at DESC);

CREATE TABLE match_players (
  match_id        TEXT NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
  seat_index      INTEGER NOT NULL,
  -- NULL for bots; a deleted account keeps the match history.
  user_id         TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  result          TEXT CHECK (result IN ('win', 'loss', 'forfeit', 'abandoned')),
  final_hand_size INTEGER,
  is_bot          INTEGER NOT NULL DEFAULT 0 CHECK (is_bot IN (0, 1)),
  PRIMARY KEY (match_id, seat_index)
);
CREATE INDEX match_players_user ON match_players (user_id);

CREATE TABLE player_stats (
  user_id         TEXT PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  games_played    INTEGER NOT NULL DEFAULT 0,
  wins            INTEGER NOT NULL DEFAULT 0,
  losses          INTEGER NOT NULL DEFAULT 0,
  current_streak  INTEGER NOT NULL DEFAULT 0,
  longest_streak  INTEGER NOT NULL DEFAULT 0,
  elo             INTEGER NOT NULL DEFAULT 1000,
  last_updated    INTEGER NOT NULL
);

CREATE TABLE friendships (
  user_a     TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  user_b     TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a <> user_b)
);
CREATE INDEX friendships_user_b ON friendships (user_b);

CREATE TABLE reports (
  report_id   TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  reported_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  created_at  INTEGER NOT NULL
);
CREATE INDEX reports_reported ON reports (reported_id);
