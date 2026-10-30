# Data Contract

Protocol version: **`PROTOCOL_VERSION = 1`**. All `ts` blocks in this file are concatenated in order and compiled by `scripts/check-contract.sh` (strict mode). They become `packages/contract/src/index.ts` in Phase 1.

## 1. Versioning

```ts
export const PROTOCOL_VERSION = 1 as const;
/** Bump when engine behaviour changes in a way that breaks replays. */
export const RULES_VERSION = 1 as const;
```

Clients send `protocol` on every WebSocket `hello` and every HTTP request header `X-UNO-Protocol`. A server that does not support the number replies with `ERR_PROTOCOL_UNSUPPORTED` (HTTP 426 / WS close code 4426) including `minProtocol`/`maxProtocol`, and the client shows an "update required — refresh" screen.

## 2. Variants and cards

```ts
export type RulebookId = "classic" | "no_mercy";
export type Color = "red" | "yellow" | "green" | "blue";
export type MatchMode = "single_round" | "points_500" | "points_1000";

export interface GameVariant {
  rulebook: RulebookId;
  rulesVersion: number;
  minPlayers: 2;
  maxPlayers: number; // 2..10
  initialHand: 7;
  matchMode: MatchMode;
  turnTimerMs: number | null;
  // classic
  stackDrawTwo: boolean;
  strictWildDrawFour: boolean;
  jumpIn: boolean;
  // no mercy
  allowLowerStack: boolean;
  sevenZeroRules: boolean;
  mercyThreshold: number;
}

export type ClassicFace =
  | "number" | "skip" | "reverse" | "draw_two" | "wild" | "wild_draw_four";

export type NoMercyFace =
  | "number" | "skip" | "reverse" | "draw_two" | "draw_four"
  | "discard_all" | "skip_everyone"
  | "wild_reverse_draw_four" | "wild_draw_six" | "wild_draw_ten"
  | "wild_color_roulette";

export type CardFace = ClassicFace | NoMercyFace;

/** Static, data-driven definition. Lives in decks/*.json. */
export interface CardDefinition {
  /** Unique within a deck, e.g. "nm-red-7-a". Stable across versions. */
  id: string;
  rulebook: RulebookId;
  face: CardFace;
  /** null for wilds. */
  color: Color | null;
  /** 0-9 for number cards, otherwise null. */
  value: number | null;
  /** Penalty cards added to a stack, or 0. */
  drawAmount: number;
  stackable: boolean;
  /** Scoring points of this card in a losing hand. */
  points: number;
  /** Canonical asset name without extension, see ASSET_SPEC.md. */
  asset: string;
}
```

## 3. Game state (server-only, authoritative)

```ts
export type PlayerId = string;
export type SeatIndex = number;
export type CommandId = string;
export type RoomCode = string; // 6 chars A-Z2-9

export type Phase =
  | "lobby"
  | "awaiting_play_or_draw"
  | "play_or_draw"
  | "awaiting_challenge"
  | "facing_penalty"
  | "awaiting_roulette_color"
  | "round_over"
  | "match_over"
  | "abandoned";

export type Direction = 1 | -1;

export interface PlayerState {
  id: PlayerId;
  seat: SeatIndex;
  displayName: string;
  avatar: string;
  hand: string[]; // card ids, private
  connected: boolean;
  isBot: boolean;
  eliminated: boolean;
  forfeited: boolean;
  unoCalled: boolean;
  consecutiveTimeouts: number;
  score: number;
}

export interface PendingStack {
  total: number;
  topValue: number; // value of the last stack card (for N01)
  targetSeat: SeatIndex;
}

export interface PendingChallenge {
  /** Seat that played the Wild Draw Four. */
  playedBySeat: SeatIndex;
  targetSeat: SeatIndex;
  /** True if the player held the active colour at play time. */
  wasIllegal: boolean;
  previousColor: Color;
  deadlineMs: number;
}

export interface UnoWindow {
  seat: SeatIndex;
  closesAtMs: number;
}

export interface GameState {
  matchId: string;
  roomCode: RoomCode;
  variant: GameVariant;
  seed: string;
  /** Opaque PRNG state to continue shuffles. */
  rngState: string;
  phase: Phase;
  round: number;
  stateVersion: number;
  players: PlayerState[];
  drawPile: string[];
  discardPile: string[];
  setAside: string[]; // eliminated hands (No Mercy)
  currentSeat: SeatIndex;
  direction: Direction;
  activeColor: Color;
  pendingStack: PendingStack | null;
  pendingChallenge: PendingChallenge | null;
  rouletteTargetSeat: SeatIndex | null;
  unoWindow: UnoWindow | null;
  turnDeadlineMs: number | null;
  /** Seat that drew a card and may play it (phase play_or_draw). */
  drawnCardId: string | null;
  seenCommandIds: CommandId[];
}
```

## 4. Commands (client → server)

```ts
interface CommandBase {
  commandId: CommandId;
  /** Client's last known stateVersion; stale commands are re-validated, not trusted. */
  expectedVersion?: number;
}

export type PlayerCommand =
  | (CommandBase & {
      type: "play_card";
      cardId: string;
      chosenColor?: Color;
      swapTargetSeat?: SeatIndex; // No Mercy 7
      callUno?: boolean;
    })
  | (CommandBase & { type: "draw_card" })
  | (CommandBase & { type: "pass_turn" })
  | (CommandBase & { type: "challenge" })
  | (CommandBase & { type: "accept" })
  | (CommandBase & { type: "choose_color"; color: Color })
  | (CommandBase & { type: "call_uno" })
  | (CommandBase & { type: "catch_uno"; targetSeat: SeatIndex })
  | (CommandBase & { type: "leave" });

export type LobbyCommand =
  | { type: "set_ready"; ready: boolean }
  | { type: "update_variant"; variant: Partial<GameVariant> }
  | { type: "kick"; playerId: PlayerId }
  | { type: "add_bot"; difficulty: "easy" | "normal" | "hard" }
  | { type: "start_match" };

export type ErrorCode =
  | "ERR_PROTOCOL_UNSUPPORTED"
  | "ERR_NOT_YOUR_TURN"
  | "ERR_ILLEGAL_MOVE"
  | "ERR_UNKNOWN_CARD"
  | "ERR_WRONG_PHASE"
  | "ERR_MUST_STACK_OR_DRAW"
  | "ERR_MUST_PLAY_DRAWN"
  | "ERR_COLOR_REQUIRED"
  | "ERR_TARGET_REQUIRED"
  | "ERR_ROUND_OVER"
  | "ERR_ROOM_FULL"
  | "ERR_ROOM_NOT_FOUND"
  | "ERR_UNAUTHORIZED"
  | "ERR_RATE_LIMITED"
  | "ERR_INTERNAL";
```

## 5. Snapshots and events (server → client)

```ts
export interface PublicPlayer {
  seat: SeatIndex;
  id: PlayerId;
  displayName: string;
  avatar: string;
  handCount: number;
  connected: boolean;
  isBot: boolean;
  eliminated: boolean;
  forfeited: boolean;
  unoCalled: boolean;
  score: number;
}

/** Sent to everyone, including spectators. No hidden information. */
export interface PublicSnapshot {
  matchId: string;
  roomCode: RoomCode;
  variant: GameVariant;
  stateVersion: number;
  phase: Phase;
  round: number;
  players: PublicPlayer[];
  drawPileCount: number;
  topCard: string | null;
  discardCount: number;
  currentSeat: SeatIndex;
  direction: Direction;
  activeColor: Color;
  pendingStack: PendingStack | null;
  pendingChallenge: Omit<PendingChallenge, "wasIllegal"> | null;
  rouletteTargetSeat: SeatIndex | null;
  unoWindow: UnoWindow | null;
  turnDeadlineMs: number | null;
  serverTimeMs: number;
}

/** Sent only to one player. */
export interface PrivateSnapshot {
  seat: SeatIndex;
  hand: string[];
  playableCardIds: string[];
  canDraw: boolean;
  canPass: boolean;
  canChallenge: boolean;
  drawnCardId: string | null;
}

export type ServerEvent =
  | { type: "match_started"; seed: string }
  | { type: "card_played"; seat: SeatIndex; cardId: string; chosenColor: Color | null }
  | { type: "cards_drawn"; seat: SeatIndex; count: number; cardIds?: string[]; reason: "voluntary" | "penalty" | "uno_penalty" | "challenge" | "roulette" | "draw_until_play" }
  | { type: "turn_changed"; seat: SeatIndex; direction: Direction }
  | { type: "color_chosen"; seat: SeatIndex; color: Color }
  | { type: "hands_swapped"; a: SeatIndex; b: SeatIndex }
  | { type: "hands_rotated"; direction: Direction }
  | { type: "uno_called"; seat: SeatIndex }
  | { type: "uno_caught"; catcher: SeatIndex; target: SeatIndex }
  | { type: "challenge_resolved"; challenger: SeatIndex; success: boolean }
  | { type: "player_eliminated"; seat: SeatIndex; knockoutCreditSeat: SeatIndex | null }
  | { type: "pile_reshuffled"; newDrawCount: number }
  | { type: "player_connection"; seat: SeatIndex; connected: boolean }
  | { type: "round_over"; winnerSeat: SeatIndex; points: number }
  | { type: "match_over"; summary: MatchSummary }
  | { type: "error"; code: ErrorCode; message: string; commandId?: CommandId };

export interface MatchSummary {
  matchId: string;
  rulebook: RulebookId;
  rulesVersion: number;
  seed: string;
  startedAtMs: number;
  endedAtMs: number;
  endReason: "hand_empty" | "last_standing" | "points_target" | "forfeit" | "abandoned";
  winnerPlayerId: PlayerId | null;
  players: Array<{
    playerId: PlayerId;
    seat: SeatIndex;
    finalScore: number;
    placement: number;
    eliminated: boolean;
    knockouts: number;
  }>;
  rounds: Array<{ round: number; winnerSeat: SeatIndex; points: number }>;
  /** Command log for replays. */
  commandCount: number;
}
```

## 6. WebSocket message schema

Endpoint: `wss://<host>/ws/room/<ROOM_CODE>?token=<sessionToken>`. Each frame is JSON.

```ts
export interface Envelope<T extends string, P> {
  v: typeof PROTOCOL_VERSION;
  t: T;
  seq: number; // monotonically increasing per sender
  p: P;
}

export type ClientMessage =
  | Envelope<"hello", { protocol: number; resumeFromVersion?: number; clientBuild: string }>
  | Envelope<"command", PlayerCommand>
  | Envelope<"lobby", LobbyCommand>
  | Envelope<"chat", { text: string }>
  | Envelope<"ping", { clientTimeMs: number }>;

export type ServerMessage =
  | Envelope<"welcome", { protocol: number; minProtocol: number; maxProtocol: number; seat: SeatIndex | null; serverTimeMs: number }>
  | Envelope<"snapshot", { public: PublicSnapshot; private: PrivateSnapshot | null }>
  | Envelope<"events", { fromVersion: number; toVersion: number; events: ServerEvent[] }>
  | Envelope<"chat", { seat: SeatIndex; text: string; atMs: number }>
  | Envelope<"pong", { clientTimeMs: number; serverTimeMs: number }>
  | Envelope<"error", { code: ErrorCode; message: string; minProtocol?: number; maxProtocol?: number }>;
```

Rules:

- Handshake: client sends `hello`; server answers `welcome` + a full `snapshot`. If `protocol` is outside `[minProtocol, maxProtocol]` the server sends `error ERR_PROTOCOL_UNSUPPORTED` and closes with code 4426.
- After every accepted command the server broadcasts `events` (shared) then each socket receives its own `snapshot.private` only when its hand changed. A client that detects a version gap requests resync by sending `hello` with `resumeFromVersion`.
- Heartbeat: client `ping` every 15 s; server drops a socket after 45 s of silence.
- Rate limit: 20 commands / 5 s per socket, 5 chat messages / 10 s. Excess → `ERR_RATE_LIMITED`.
- Hidden information: `ServerEvent.cards_drawn.cardIds` is only included in the copy sent to the drawing seat.

## 7. HTTP route table

All routes are under `https://<host>/api`, JSON, `X-UNO-Protocol` required.

| Method | Path | Auth | Phase | Purpose |
|---|---|---|---|---|
| GET | `/api/health` | none | 1 | Build id, protocol range |
| POST | `/api/guest` | none | 1 | Create guest session → `{ playerId, token }` |
| POST | `/api/rooms` | session | 2 | Create room `{ variant }` → `{ roomCode }` |
| GET | `/api/rooms/:code` | session | 2 | Room metadata (exists, player count, rulebook) |
| POST | `/api/rooms/:code/join` | session | 2 | Reserve a seat, returns WS URL |
| GET | `/api/rooms/public` | session | 5 | Public lobby listing |
| GET | `/api/matches/:id` | session | 3 | `MatchSummary` |
| GET | `/api/matches/:id/replay` | session | 6 | Seed + command log |
| GET | `/api/me` | session | 4 | Profile |
| PATCH | `/api/me` | account | 4 | Name, avatar |
| GET | `/api/me/matches` | account | 4 | History |
| GET | `/api/leaderboard` | none | 6 | Top players per rulebook |
| GET | `/auth/google` | none | 4 | Start OAuth |
| GET | `/auth/google/callback` | none | 4 | OAuth callback (registered redirect URI) |
| POST | `/auth/logout` | session | 4 | End session |

Error body: `{ "error": { "code": ErrorCode, "message": string } }`.

```ts
export interface HttpErrorBody {
  error: { code: ErrorCode; message: string };
}

export interface GuestSessionResponse {
  playerId: PlayerId;
  token: string;
  expiresAtMs: number;
}

export interface CreateRoomRequest {
  variant: Partial<GameVariant> & { rulebook: RulebookId };
  isPublic: boolean;
}

export interface CreateRoomResponse {
  roomCode: RoomCode;
  wsUrl: string;
}
```

## 8. D1 tables (summary; migrations in Phase 4)

`players(id, display_name, avatar, google_sub NULL, created_at)` · `sessions(token_hash, player_id, expires_at)` · `matches(id, rulebook, rules_version, seed, started_at, ended_at, end_reason, winner_player_id)` · `match_players(match_id, player_id, seat, final_score, placement, eliminated, knockouts)` · `match_commands(match_id, idx, command_json)` · `ratings(player_id, rulebook, elo, games)`.

Hot game state lives in the Durable Object; D1 is written only at match end (and for accounts/sessions).
