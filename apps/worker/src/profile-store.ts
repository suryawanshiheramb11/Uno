import {
  DEFAULT_PREFERENCES,
  resolvePreferences,
  type MatchSummaryRow,
  type MeResponse,
  type Preferences,
  type Profile,
  type Stats,
} from "@uno/shared";

export class ConflictError extends Error {}

export interface SessionUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image?: string | null;
  /** Set by Better Auth's anonymous plugin for guest accounts. */
  isAnonymous?: boolean | null;
}

interface ProfileRow {
  display_name: string;
  avatar_seed: string;
  preferences_json: string;
  created_at: number;
  updated_at: number;
}
interface StatsRow {
  games_played: number;
  wins: number;
  losses: number;
  current_streak: number;
  longest_streak: number;
  elo: number;
  last_updated: number;
}

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Error && /UNIQUE constraint failed/i.test(e.message);

/** A starting display name from the account name (letters, digits, spaces; 3-20 chars). */
export function suggestDisplayName(accountName: string): string {
  const cleaned = accountName
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
    .replace(/ +/g, " ")
    .slice(0, 20)
    .trim();
  return cleaned.length >= 3 ? cleaned : "Player";
}

function withSuffix(base: string, attempt: number): string {
  if (attempt === 0) return base;
  const suffix = ` ${Math.floor(1000 + Math.random() * 9000)}`;
  return base.slice(0, 20 - suffix.length).trimEnd() + suffix;
}

function toProfile(row: ProfileRow): Profile {
  let stored: unknown = {};
  try {
    stored = JSON.parse(row.preferences_json);
  } catch {
    /* corrupt JSON falls back to defaults */
  }
  return {
    displayName: row.display_name,
    avatarSeed: row.avatar_seed,
    preferences: resolvePreferences(stored),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStats(row: StatsRow): Stats {
  return {
    gamesPlayed: row.games_played,
    wins: row.wins,
    losses: row.losses,
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak,
    elo: row.elo,
    lastUpdated: row.last_updated,
  };
}

const PROFILE_SQL =
  "SELECT display_name, avatar_seed, preferences_json, created_at, updated_at FROM user_profiles WHERE user_id = ?";
const STATS_SQL =
  "SELECT games_played, wins, losses, current_streak, longest_streak, elo, last_updated FROM player_stats WHERE user_id = ?";

/** Creates the profile and stats rows on first use. Idempotent and safe under concurrent first requests. */
async function ensureProfile(db: D1Database, user: SessionUser): Promise<void> {
  const existing = await db
    .prepare("SELECT 1 AS x FROM user_profiles WHERE user_id = ?")
    .bind(user.id)
    .first();
  if (existing) return;
  const base = suggestDisplayName(user.name);
  const now = Date.now();
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await db.batch([
        db
          .prepare(
            "INSERT INTO user_profiles (user_id, display_name, avatar_seed, preferences_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(
            user.id,
            withSuffix(base, attempt),
            user.id.slice(0, 16),
            JSON.stringify({}),
            now,
            now,
          ),
        db
          .prepare("INSERT OR IGNORE INTO player_stats (user_id, last_updated) VALUES (?, ?)")
          .bind(user.id, now),
      ]);
      return;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // Either the name was taken (retry with a suffix) or a concurrent request created the row (done).
      const created = await db
        .prepare("SELECT 1 AS x FROM user_profiles WHERE user_id = ?")
        .bind(user.id)
        .first();
      if (created) return;
    }
  }
  throw new Error("Could not allocate a unique display name");
}

export async function getMe(db: D1Database, user: SessionUser): Promise<MeResponse> {
  await ensureProfile(db, user);
  const [profile, stats] = await Promise.all([
    db.prepare(PROFILE_SQL).bind(user.id).first<ProfileRow>(),
    db.prepare(STATS_SQL).bind(user.id).first<StatsRow>(),
  ]);
  if (!profile || !stats) throw new Error("Profile missing after creation");
  return {
    user: {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image ?? null,
      isGuest: Boolean(user.isAnonymous),
    },
    profile: toProfile(profile),
    stats: toStats(stats),
  };
}

export async function updateProfile(
  db: D1Database,
  user: SessionUser,
  changes: { displayName?: string; avatarSeed?: string },
): Promise<Profile> {
  await ensureProfile(db, user);
  const sets: string[] = [];
  const values: unknown[] = [];
  if (changes.displayName !== undefined) {
    sets.push("display_name = ?");
    values.push(changes.displayName);
  }
  if (changes.avatarSeed !== undefined) {
    sets.push("avatar_seed = ?");
    values.push(changes.avatarSeed);
  }
  sets.push("updated_at = ?");
  values.push(Date.now(), user.id);
  try {
    await db
      .prepare(`UPDATE user_profiles SET ${sets.join(", ")} WHERE user_id = ?`)
      .bind(...values)
      .run();
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("That display name is already taken.");
    throw e;
  }
  return toProfile((await db.prepare(PROFILE_SQL).bind(user.id).first<ProfileRow>()) as ProfileRow);
}

export async function updatePreferences(
  db: D1Database,
  user: SessionUser,
  patch: Partial<Preferences>,
): Promise<Preferences> {
  await ensureProfile(db, user);
  const row = await db.prepare(PROFILE_SQL).bind(user.id).first<ProfileRow>();
  const current = toProfile(row as ProfileRow).preferences;
  const next: Preferences = { ...DEFAULT_PREFERENCES, ...current, ...patch };
  await db
    .prepare("UPDATE user_profiles SET preferences_json = ?, updated_at = ? WHERE user_id = ?")
    .bind(JSON.stringify(next), Date.now(), user.id)
    .run();
  return next;
}

interface MatchRow {
  match_id: string;
  variant: MatchSummaryRow["variant"];
  mode: MatchSummaryRow["mode"];
  started_at: number;
  ended_at: number | null;
  winner_id: string | null;
  seat_index: number;
  result: MatchSummaryRow["result"];
  final_hand_size: number | null;
}

export async function listMatches(
  db: D1Database,
  userId: string,
  limit: number,
): Promise<MatchSummaryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT m.match_id, m.variant, m.mode, m.started_at, m.ended_at, m.winner_id,
              p.seat_index, p.result, p.final_hand_size
         FROM match_players p JOIN matches m ON m.match_id = p.match_id
        WHERE p.user_id = ?
        ORDER BY m.started_at DESC LIMIT ?`,
    )
    .bind(userId, limit)
    .all<MatchRow>();
  return results.map((r) => ({
    matchId: r.match_id,
    variant: r.variant,
    mode: r.mode,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    winnerId: r.winner_id,
    seatIndex: r.seat_index,
    result: r.result,
    finalHandSize: r.final_hand_size,
  }));
}

/**
 * A guest signed in to a real account: move what they earned across. Match history is re-pointed at the new
 * account, and games/wins/losses are added to its stats (rating and current streak stay with the real account).
 * The guest's own profile row is removed by the cascade when Better Auth deletes the guest user.
 */
export async function mergeGuestInto(
  db: D1Database,
  guestId: string,
  userId: string,
): Promise<void> {
  const guest = await db.prepare(STATS_SQL).bind(guestId).first<StatsRow>();
  const now = Date.now();
  const statements = [
    db
      .prepare("INSERT OR IGNORE INTO player_stats (user_id, last_updated) VALUES (?, ?)")
      .bind(userId, now),
    db.prepare("UPDATE match_players SET user_id = ? WHERE user_id = ?").bind(userId, guestId),
  ];
  if (guest) {
    statements.push(
      db
        .prepare(
          "UPDATE player_stats SET games_played = games_played + ?, wins = wins + ?, losses = losses + ?, longest_streak = MAX(longest_streak, ?), last_updated = ? WHERE user_id = ?",
        )
        .bind(guest.games_played, guest.wins, guest.losses, guest.longest_streak, now, userId),
    );
  }
  await db.batch(statements);
}
