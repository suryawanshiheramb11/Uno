export type Color = "red" | "yellow" | "green" | "blue";
export const COLORS: readonly Color[] = ["red", "yellow", "green", "blue"];

export type Face = "number" | "skip" | "reverse" | "draw_two" | "wild" | "wild_draw_four";

/** Static definition of a card. The id -> definition mapping is a pure function of the id. */
export interface CardDef {
  color: Color | null;
  face: Face;
  /** 0-9 for number cards, otherwise null. */
  value: number | null;
}
export interface Card extends CardDef {
  id: string;
}

export interface ClassicConfig {
  initialHandSize: number;
  /** Window after playing down to one card in which the player may call UNO / others may catch. */
  unoWindowMs: number;
  unoPenalty: number;
  /** When true, Wild Draw Four is only playable without a card of the active colour (no bluffing). */
  strictWildDrawFour: boolean;
  /** null = a match is one hand. Otherwise play hands until someone reaches this score. */
  targetScore: number | null;
}

export const DEFAULT_CLASSIC_CONFIG: ClassicConfig = {
  initialHandSize: 7,
  unoWindowMs: 3000,
  unoPenalty: 2,
  strictWildDrawFour: false,
  targetScore: null,
};

export type Phase =
  | "pre_hand"
  | "awaiting_opening_color"
  | "awaiting_play_or_draw"
  | "play_or_draw"
  | "awaiting_challenge"
  | "hand_over"
  | "match_over";

export const IN_HAND_PHASES: readonly Phase[] = [
  "awaiting_opening_color",
  "awaiting_play_or_draw",
  "play_or_draw",
  "awaiting_challenge",
];

export interface PlayerState {
  id: string;
  hand: string[];
  score: number;
  resigned: boolean;
  unoCalled: boolean;
}

export interface PendingChallenge {
  playedById: string;
  targetId: string;
  /** Colour that was active before the Wild Draw Four. */
  previousColor: Color;
  /** True iff the player held a card of previousColor when playing it (the play was illegal). */
  hadMatchingColor: boolean;
}

export interface UnoWindow {
  playerId: string;
  openedAt: number;
}

export interface HandResult {
  hand: number;
  winnerId: string;
  points: number;
}

export type EndReason = "hand_empty" | "points_target" | "forfeit";

export interface MatchSummary {
  variant: "classic";
  winnerId: string | null;
  endReason: EndReason;
  hands: HandResult[];
  players: Array<{ id: string; score: number; placement: number; resigned: boolean }>;
}

export interface GameState {
  variant: "classic";
  config: ClassicConfig;
  phase: Phase;
  handNumber: number;
  handSeed: number;
  /** xoshiro128** state; part of the game state so shuffles are reproducible. */
  rngState: [number, number, number, number];
  players: PlayerState[];
  dealerSeat: number;
  currentSeat: number;
  direction: 1 | -1;
  activeColor: Color | null;
  /** Top of the pile is the LAST element. */
  drawPile: string[];
  /** Top card is the LAST element. */
  discardPile: string[];
  drawnCardId: string | null;
  pendingChallenge: PendingChallenge | null;
  unoWindow: UnoWindow | null;
  rematchVotes: string[];
  seenCommandIds: string[];
  handWinnerId: string | null;
  matchWinnerId: string | null;
  handResults: HandResult[];
  summary: MatchSummary | null;
  version: number;
}

// ---------------------------------------------------------------- commands

interface CommandBase {
  /** Client-generated unique id; duplicates are rejected (idempotency). */
  commandId: string;
  playerId: string;
  /** Server timestamp (ms). The engine has no clock; UNO windows are measured with this. */
  at: number;
}

export type Command = CommandBase &
  (
    | { type: "START_HAND" }
    | { type: "PLAY_CARD"; cardId: string; color?: Color; callUno?: boolean }
    | { type: "DRAW_CARD" }
    | { type: "PASS_TURN" }
    | { type: "CHOOSE_COLOR"; color: Color }
    | { type: "CALL_UNO" }
    | { type: "CATCH_UNO"; targetId: string }
    | { type: "CHALLENGE_WILD_DRAW_FOUR" }
    | { type: "VOTE_REMATCH" }
    | { type: "RESIGN" }
    | { type: "REQUEST_SNAPSHOT" }
  );
export type CommandType = Command["type"];

export type RejectReason =
  | "MALFORMED_COMMAND"
  | "DUPLICATE_COMMAND"
  | "UNKNOWN_PLAYER"
  | "PLAYER_RESIGNED"
  | "WRONG_PHASE"
  | "HAND_NOT_STARTED"
  | "HAND_IN_PROGRESS"
  | "HAND_OVER"
  | "MATCH_OVER"
  | "NOT_YOUR_TURN"
  | "CARD_NOT_IN_HAND"
  | "CARD_NOT_PLAYABLE"
  | "WILD_DRAW_FOUR_ILLEGAL"
  | "COLOR_REQUIRED"
  | "COLOR_INVALID"
  | "ALREADY_DREW"
  | "NOT_DRAWN_CARD"
  | "NOTHING_TO_PASS"
  | "CHALLENGE_PENDING"
  | "COLOR_CHOICE_PENDING"
  | "NO_CHALLENGE_PENDING"
  | "NOT_CHALLENGE_TARGET"
  | "NOT_AT_UNO"
  | "ALREADY_CALLED_UNO"
  | "NOTHING_TO_CATCH"
  | "UNO_WINDOW_CLOSED"
  | "CANNOT_CATCH_SELF"
  | "ALREADY_VOTED";

export type DrawReason =
  | "voluntary"
  | "draw_two"
  | "wild_draw_four"
  | "challenge_penalty"
  | "challenge_failed"
  | "uno_penalty"
  | "opening_card";

export type SkipReason =
  "skip" | "reverse_two_player" | "draw_two" | "wild_draw_four" | "opening_card";

export type EngineEvent =
  | {
      type: "HAND_STARTED";
      handNumber: number;
      handSeed: number;
      dealerId: string;
      firstPlayerId: string;
    }
  | { type: "OPENING_CARD"; cardId: string }
  | { type: "OPENING_CARD_RESHUFFLED"; cardId: string }
  | { type: "CARD_PLAYED"; playerId: string; cardId: string; chosenColor: Color | null }
  | { type: "CARDS_DRAWN"; playerId: string; count: number; cardIds?: string[]; reason: DrawReason }
  | { type: "TURN_CHANGED"; playerId: string; direction: 1 | -1 }
  | { type: "TURN_PASSED"; playerId: string }
  | { type: "DIRECTION_REVERSED"; direction: 1 | -1 }
  | { type: "PLAYER_SKIPPED"; playerId: string; reason: SkipReason }
  | { type: "COLOR_CHOSEN"; playerId: string; color: Color }
  | { type: "UNO_CALLED"; playerId: string }
  | { type: "UNO_CAUGHT"; catcherId: string; targetId: string }
  | { type: "CHALLENGE_RESOLVED"; challengerId: string; accusedId: string; success: boolean }
  | { type: "CHALLENGE_DECLINED"; playerId: string }
  | { type: "DRAW_PILE_RESHUFFLED"; cardCount: number }
  | { type: "PLAYER_RESIGNED"; playerId: string; cardsReturned: number }
  | { type: "HAND_WON"; winnerId: string; points: number; scores: Record<string, number> }
  | { type: "MATCH_ENDED"; summary: MatchSummary }
  | { type: "REMATCH_VOTED"; playerId: string }
  | { type: "REMATCH_AGREED" }
  | { type: "SNAPSHOT_REQUESTED"; playerId: string }
  | {
      type: "COMMAND_REJECTED";
      commandId: string;
      playerId: string;
      commandType: string;
      reason: RejectReason;
    };

// ---------------------------------------------------------------- views

export type LegalMove =
  | { type: "START_HAND" }
  | { type: "PLAY_CARD"; cardId: string; requiresColor: boolean; colors: Color[] }
  | { type: "DRAW_CARD" }
  | { type: "PASS_TURN" }
  | { type: "CHOOSE_COLOR"; color: Color }
  | { type: "CALL_UNO" }
  | { type: "CATCH_UNO"; targetId: string }
  | { type: "CHALLENGE_WILD_DRAW_FOUR" }
  | { type: "VOTE_REMATCH" }
  | { type: "RESIGN" }
  | { type: "REQUEST_SNAPSHOT" };

export interface PublicPlayer {
  id: string;
  seat: number;
  handCount: number;
  score: number;
  unoCalled: boolean;
  resigned: boolean;
}

/** Everything every viewer (including spectators) may see. Never contains card ids from hands or the draw pile. */
export interface PublicSnapshot {
  variant: "classic";
  version: number;
  phase: Phase;
  handNumber: number;
  players: PublicPlayer[];
  currentPlayerId: string | null;
  direction: 1 | -1;
  activeColor: Color | null;
  topCardId: string | null;
  discardCount: number;
  drawPileCount: number;
  pendingChallenge: { playedById: string; targetId: string } | null;
  unoWindow: { playerId: string; closesAt: number } | null;
  handWinnerId: string | null;
  matchWinnerId: string | null;
  rematchVotes: string[];
  summary: MatchSummary | null;
}

export interface PrivateSnapshot extends PublicSnapshot {
  selfId: string;
  seat: number;
  hand: string[];
  playableCardIds: string[];
  drawnCardId: string | null;
  legalMoves: LegalMove[];
}

export class EngineError extends Error {
  constructor(
    public readonly code: "UNSUPPORTED_VARIANT" | "INVALID_PLAYERS" | "INVALID_CONFIG",
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}
