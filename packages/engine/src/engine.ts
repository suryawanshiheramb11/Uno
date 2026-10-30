import type { Variant } from "@uno/shared";
import { DECK_SIZE, cardDefOf, cardPoints, isValidCardId, makeCardId } from "./cards";
import { nextUint32, seedRngState, shuffleInPlace } from "./rng";
import type { Rng } from "./rng";
import { activeSeats, canPlayCard, isInHand, stepSeat } from "./rules";
import { COLORS, DEFAULT_CLASSIC_CONFIG, EngineError } from "./types";
import type {
  ClassicConfig,
  Color,
  Command,
  DrawReason,
  EndReason,
  EngineEvent,
  GameState,
  MatchSummary,
  PlayerState,
  RejectReason,
} from "./types";

type Events = EngineEvent[];
type Handler<C extends Command = Command> = (
  s: GameState,
  cmd: C,
  events: Events,
) => RejectReason | null;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ------------------------------------------------------------------ creation

export function createInitialState(
  variant: Variant,
  playerIds: string[],
  config: Partial<ClassicConfig>,
  rng: Rng,
): GameState {
  if (variant !== "classic") {
    throw new EngineError(
      "UNSUPPORTED_VARIANT",
      `Variant not implemented in this engine: ${variant}`,
    );
  }
  if (
    !Array.isArray(playerIds) ||
    playerIds.length < 2 ||
    playerIds.length > 10 ||
    playerIds.some((id) => typeof id !== "string" || id === "") ||
    new Set(playerIds).size !== playerIds.length
  ) {
    throw new EngineError("INVALID_PLAYERS", "Classic needs 2-10 unique, non-empty player ids");
  }
  const merged: ClassicConfig = { ...DEFAULT_CLASSIC_CONFIG, ...config };
  if (
    merged.initialHandSize < 1 ||
    merged.initialHandSize * playerIds.length >= DECK_SIZE - 8 ||
    merged.unoWindowMs < 0 ||
    merged.unoPenalty < 0
  ) {
    throw new EngineError("INVALID_CONFIG", "Config values out of range");
  }
  return {
    variant: "classic",
    config: merged,
    phase: "pre_hand",
    handNumber: 0,
    handSeed: 0,
    rngState: seedRngState(rng),
    players: playerIds.map((id) => ({ id, hand: [], score: 0, resigned: false, unoCalled: false })),
    dealerSeat: playerIds.length - 1,
    currentSeat: 0,
    direction: 1,
    activeColor: null,
    drawPile: [],
    discardPile: [],
    drawnCardId: null,
    pendingChallenge: null,
    unoWindow: null,
    rematchVotes: [],
    seenCommandIds: [],
    handWinnerId: null,
    matchWinnerId: null,
    handResults: [],
    summary: null,
    version: 0,
  };
}

// ------------------------------------------------------------------ helpers

function playerAt(s: GameState, seat: number): PlayerState {
  return s.players[seat] as PlayerState;
}

function seatOf(s: GameState, id: string): number {
  return s.players.findIndex((p) => p.id === id);
}

function reshuffleIfNeeded(s: GameState, events: Events): void {
  if (s.drawPile.length > 0 || s.discardPile.length <= 1) return;
  const top = s.discardPile.pop() as string;
  s.drawPile = s.discardPile;
  s.discardPile = [top];
  shuffleInPlace(s.drawPile, s.rngState);
  events.push({ type: "DRAW_PILE_RESHUFFLED", cardCount: s.drawPile.length });
}

function drawCards(
  s: GameState,
  seat: number,
  count: number,
  reason: DrawReason,
  events: Events,
): string[] {
  const player = playerAt(s, seat);
  const drawn: string[] = [];
  for (let i = 0; i < count; i++) {
    reshuffleIfNeeded(s, events);
    const id = s.drawPile.pop();
    if (id === undefined) break;
    player.hand.push(id);
    drawn.push(id);
  }
  if (player.hand.length >= 2) {
    player.unoCalled = false;
    if (s.unoWindow?.playerId === player.id) s.unoWindow = null;
  }
  events.push({
    type: "CARDS_DRAWN",
    playerId: player.id,
    count: drawn.length,
    cardIds: drawn,
    reason,
  });
  return drawn;
}

function advanceTurn(s: GameState, from: number, steps: number, events: Events): void {
  s.currentSeat = stepSeat(s, from, s.direction, steps);
  s.phase = "awaiting_play_or_draw";
  s.drawnCardId = null;
  events.push({
    type: "TURN_CHANGED",
    playerId: playerAt(s, s.currentSeat).id,
    direction: s.direction,
  });
}

/** Any turn action by someone other than the player at one card closes that player's UNO window. */
function closeUnoWindowForOthers(s: GameState, actorId: string): void {
  if (s.unoWindow && s.unoWindow.playerId !== actorId) s.unoWindow = null;
}

function buildSummary(s: GameState, winnerId: string | null, endReason: EndReason): MatchSummary {
  const ranked = s.players
    .map((p, seat) => ({ p, seat }))
    .sort((a, b) => {
      if (a.p.id === winnerId) return -1;
      if (b.p.id === winnerId) return 1;
      return b.p.score - a.p.score || a.seat - b.seat;
    });
  return {
    variant: "classic",
    winnerId,
    endReason,
    hands: clone(s.handResults),
    players: ranked.map(({ p }, i) => ({
      id: p.id,
      score: p.score,
      placement: i + 1,
      resigned: p.resigned,
    })),
  };
}

function endMatch(s: GameState, winnerId: string | null, reason: EndReason, events: Events): void {
  s.phase = "match_over";
  s.matchWinnerId = winnerId;
  s.pendingChallenge = null;
  s.unoWindow = null;
  s.drawnCardId = null;
  s.summary = buildSummary(s, winnerId, reason);
  events.push({ type: "MATCH_ENDED", summary: clone(s.summary) });
}

function endHand(s: GameState, winnerSeat: number, events: Events): void {
  const winner = playerAt(s, winnerSeat);
  let points = 0;
  s.players.forEach((p, seat) => {
    if (seat === winnerSeat || p.resigned) return;
    for (const id of p.hand) points += cardPoints(cardDefOf(id));
  });
  winner.score += points;
  s.handWinnerId = winner.id;
  s.handResults.push({ hand: s.handNumber, winnerId: winner.id, points });
  s.pendingChallenge = null;
  s.unoWindow = null;
  s.drawnCardId = null;
  const scores: Record<string, number> = {};
  for (const p of s.players) scores[p.id] = p.score;
  events.push({ type: "HAND_WON", winnerId: winner.id, points, scores });
  const target = s.config.targetScore;
  if (target === null) endMatch(s, winner.id, "hand_empty", events);
  else if (winner.score >= target) endMatch(s, winner.id, "points_target", events);
  else s.phase = "hand_over";
}

// ------------------------------------------------------------------ dealing

function startHand(s: GameState, events: Events): void {
  s.handNumber += 1;
  s.handSeed = nextUint32(s.rngState);
  s.drawPile = Array.from({ length: DECK_SIZE }, (_, i) => makeCardId(s.handSeed, i));
  shuffleInPlace(s.drawPile, s.rngState);
  s.discardPile = [];
  for (const p of s.players) {
    p.hand = [];
    p.unoCalled = false;
  }
  s.direction = 1;
  s.pendingChallenge = null;
  s.unoWindow = null;
  s.drawnCardId = null;
  s.handWinnerId = null;
  s.rematchVotes = [];
  if (s.handNumber > 1) s.dealerSeat = stepSeat(s, s.dealerSeat, 1, 1);
  if (playerAt(s, s.dealerSeat).resigned) s.dealerSeat = stepSeat(s, s.dealerSeat, 1, 1);

  const firstSeat = stepSeat(s, s.dealerSeat, 1, 1);
  const order: number[] = [];
  let seat = firstSeat;
  for (let i = 0; i < activeSeats(s).length; i++) {
    order.push(seat);
    seat = stepSeat(s, seat, 1, 1);
  }
  for (let round = 0; round < s.config.initialHandSize; round++) {
    for (const o of order) playerAt(s, o).hand.push(s.drawPile.pop() as string);
  }
  events.push({
    type: "HAND_STARTED",
    handNumber: s.handNumber,
    handSeed: s.handSeed,
    dealerId: playerAt(s, s.dealerSeat).id,
    firstPlayerId: playerAt(s, firstSeat).id,
  });

  // Opening card: a Wild Draw Four is shuffled back and replaced.
  let opening = s.drawPile.pop() as string;
  for (let guard = 0; cardDefOf(opening).face === "wild_draw_four" && guard < 100; guard++) {
    events.push({ type: "OPENING_CARD_RESHUFFLED", cardId: opening });
    s.drawPile.push(opening);
    shuffleInPlace(s.drawPile, s.rngState);
    opening = s.drawPile.pop() as string;
  }
  s.discardPile.push(opening);
  const def = cardDefOf(opening);
  s.activeColor = def.color;
  events.push({ type: "OPENING_CARD", cardId: opening });

  s.currentSeat = firstSeat;
  s.phase = "awaiting_play_or_draw";
  switch (def.face) {
    case "wild":
      s.phase = "awaiting_opening_color";
      break;
    case "skip":
      events.push({
        type: "PLAYER_SKIPPED",
        playerId: playerAt(s, firstSeat).id,
        reason: "opening_card",
      });
      s.currentSeat = stepSeat(s, firstSeat, 1, 1);
      break;
    case "draw_two":
      drawCards(s, firstSeat, 2, "opening_card", events);
      events.push({
        type: "PLAYER_SKIPPED",
        playerId: playerAt(s, firstSeat).id,
        reason: "opening_card",
      });
      s.currentSeat = stepSeat(s, firstSeat, 1, 1);
      break;
    case "reverse":
      s.direction = -1;
      events.push({ type: "DIRECTION_REVERSED", direction: -1 });
      s.currentSeat = s.dealerSeat;
      break;
    default:
      break;
  }
  events.push({
    type: "TURN_CHANGED",
    playerId: playerAt(s, s.currentSeat).id,
    direction: s.direction,
  });
}

// ------------------------------------------------------------------ handlers

const startHandCmd: Handler = (s, _cmd, events) => {
  if (s.phase === "match_over") return "MATCH_OVER";
  if (isInHand(s)) return "HAND_IN_PROGRESS";
  startHand(s, events);
  return null;
};

function phaseRejection(s: GameState): RejectReason | null {
  switch (s.phase) {
    case "pre_hand":
      return "HAND_NOT_STARTED";
    case "hand_over":
      return "HAND_OVER";
    case "match_over":
      return "MATCH_OVER";
    default:
      return null;
  }
}

const playCard: Handler<Extract<Command, { type: "PLAY_CARD" }>> = (s, cmd, events) => {
  const gate = phaseRejection(s);
  if (gate) return gate;
  const seat = seatOf(s, cmd.playerId);
  if (seat !== s.currentSeat) return "NOT_YOUR_TURN";
  if (s.phase === "awaiting_challenge") return "CHALLENGE_PENDING";
  if (s.phase === "awaiting_opening_color") return "COLOR_CHOICE_PENDING";
  const player = playerAt(s, seat);
  if (!isValidCardId(cmd.cardId) || !player.hand.includes(cmd.cardId)) return "CARD_NOT_IN_HAND";
  if (s.phase === "play_or_draw" && cmd.cardId !== s.drawnCardId) return "NOT_DRAWN_CARD";
  const def = cardDefOf(cmd.cardId);
  if (!canPlayCard(s, player, cmd.cardId)) {
    return def.face === "wild_draw_four" ? "WILD_DRAW_FOUR_ILLEGAL" : "CARD_NOT_PLAYABLE";
  }
  let chosen: Color | null = null;
  if (def.color === null) {
    if (cmd.color === undefined) return "COLOR_REQUIRED";
    if (!COLORS.includes(cmd.color)) return "COLOR_INVALID";
    chosen = cmd.color;
  }

  const previousColor = s.activeColor as Color;
  closeUnoWindowForOthers(s, player.id);
  player.hand.splice(player.hand.indexOf(cmd.cardId), 1);
  s.discardPile.push(cmd.cardId);
  s.drawnCardId = null;
  s.activeColor = def.color ?? chosen;
  events.push({
    type: "CARD_PLAYED",
    playerId: player.id,
    cardId: cmd.cardId,
    chosenColor: chosen,
  });
  if (chosen) events.push({ type: "COLOR_CHOSEN", playerId: player.id, color: chosen });

  if (player.hand.length === 1) {
    if (cmd.callUno) {
      player.unoCalled = true;
      events.push({ type: "UNO_CALLED", playerId: player.id });
    } else {
      s.unoWindow = { playerId: player.id, openedAt: cmd.at };
    }
  }

  const won = player.hand.length === 0;
  let advance: number | null = 1;
  switch (def.face) {
    case "number":
    case "wild":
      break;
    case "skip": {
      if (!won) {
        events.push({
          type: "PLAYER_SKIPPED",
          playerId: playerAt(s, stepSeat(s, seat, s.direction, 1)).id,
          reason: "skip",
        });
      }
      advance = 2;
      break;
    }
    case "reverse": {
      s.direction = s.direction === 1 ? -1 : 1;
      events.push({ type: "DIRECTION_REVERSED", direction: s.direction });
      if (activeSeats(s).length === 2) {
        if (!won) {
          events.push({
            type: "PLAYER_SKIPPED",
            playerId: playerAt(s, stepSeat(s, seat, s.direction, 1)).id,
            reason: "reverse_two_player",
          });
        }
        advance = 2;
      }
      break;
    }
    case "draw_two": {
      const victim = stepSeat(s, seat, s.direction, 1);
      drawCards(s, victim, 2, "draw_two", events);
      if (!won)
        events.push({
          type: "PLAYER_SKIPPED",
          playerId: playerAt(s, victim).id,
          reason: "draw_two",
        });
      advance = 2;
      break;
    }
    case "wild_draw_four": {
      const victim = stepSeat(s, seat, s.direction, 1);
      if (won) {
        drawCards(s, victim, 4, "wild_draw_four", events);
        advance = 2;
      } else {
        s.pendingChallenge = {
          playedById: player.id,
          targetId: playerAt(s, victim).id,
          previousColor,
          hadMatchingColor: player.hand.some((id) => cardDefOf(id).color === previousColor),
        };
        s.currentSeat = victim;
        s.phase = "awaiting_challenge";
        events.push({
          type: "TURN_CHANGED",
          playerId: playerAt(s, victim).id,
          direction: s.direction,
        });
        advance = null;
      }
      break;
    }
  }
  if (won) {
    endHand(s, seat, events);
    return null;
  }
  if (advance !== null) advanceTurn(s, seat, advance, events);
  return null;
};

const drawCard: Handler = (s, cmd, events) => {
  const gate = phaseRejection(s);
  if (gate) return gate;
  const seat = seatOf(s, cmd.playerId);
  if (seat !== s.currentSeat) return "NOT_YOUR_TURN";
  if (s.phase === "awaiting_opening_color") return "COLOR_CHOICE_PENDING";
  if (s.phase === "play_or_draw") return "ALREADY_DREW";
  const player = playerAt(s, seat);
  closeUnoWindowForOthers(s, player.id);
  if (s.phase === "awaiting_challenge") {
    events.push({ type: "CHALLENGE_DECLINED", playerId: player.id });
    s.pendingChallenge = null;
    drawCards(s, seat, 4, "wild_draw_four", events);
    advanceTurn(s, seat, 1, events);
    return null;
  }
  const drawn = drawCards(s, seat, 1, "voluntary", events);
  const card = drawn[0];
  if (card !== undefined && canPlayCard(s, player, card)) {
    s.phase = "play_or_draw";
    s.drawnCardId = card;
  } else {
    advanceTurn(s, seat, 1, events);
  }
  return null;
};

const passTurn: Handler = (s, cmd, events) => {
  const gate = phaseRejection(s);
  if (gate) return gate;
  const seat = seatOf(s, cmd.playerId);
  if (seat !== s.currentSeat) return "NOT_YOUR_TURN";
  if (s.phase === "awaiting_challenge") return "CHALLENGE_PENDING";
  if (s.phase === "awaiting_opening_color") return "COLOR_CHOICE_PENDING";
  if (s.phase === "awaiting_play_or_draw") return "NOTHING_TO_PASS";
  closeUnoWindowForOthers(s, cmd.playerId);
  events.push({ type: "TURN_PASSED", playerId: cmd.playerId });
  advanceTurn(s, seat, 1, events);
  return null;
};

const chooseColor: Handler<Extract<Command, { type: "CHOOSE_COLOR" }>> = (s, cmd, events) => {
  if (s.phase !== "awaiting_opening_color") return "WRONG_PHASE";
  if (seatOf(s, cmd.playerId) !== s.currentSeat) return "NOT_YOUR_TURN";
  if (!COLORS.includes(cmd.color)) return "COLOR_INVALID";
  s.activeColor = cmd.color;
  s.phase = "awaiting_play_or_draw";
  events.push({ type: "COLOR_CHOSEN", playerId: cmd.playerId, color: cmd.color });
  return null;
};

const challenge: Handler = (s, cmd, events) => {
  const pending = s.pendingChallenge;
  if (s.phase !== "awaiting_challenge" || !pending) return "NO_CHALLENGE_PENDING";
  if (pending.targetId !== cmd.playerId) return "NOT_CHALLENGE_TARGET";
  const seat = seatOf(s, cmd.playerId);
  const accusedSeat = seatOf(s, pending.playedById);
  closeUnoWindowForOthers(s, cmd.playerId);
  const success = pending.hadMatchingColor;
  events.push({
    type: "CHALLENGE_RESOLVED",
    challengerId: cmd.playerId,
    accusedId: pending.playedById,
    success,
  });
  s.pendingChallenge = null;
  if (success) {
    drawCards(s, accusedSeat, 4, "challenge_penalty", events);
    advanceTurn(s, seat, 0, events);
  } else {
    drawCards(s, seat, 6, "challenge_failed", events);
    advanceTurn(s, seat, 1, events);
  }
  return null;
};

const callUno: Handler = (s, cmd, events) => {
  if (!isInHand(s)) return "WRONG_PHASE";
  const player = playerAt(s, seatOf(s, cmd.playerId));
  if (player.hand.length !== 1) return "NOT_AT_UNO";
  if (player.unoCalled) return "ALREADY_CALLED_UNO";
  player.unoCalled = true;
  if (s.unoWindow?.playerId === player.id) s.unoWindow = null;
  events.push({ type: "UNO_CALLED", playerId: player.id });
  return null;
};

const catchUno: Handler<Extract<Command, { type: "CATCH_UNO" }>> = (s, cmd, events) => {
  if (!isInHand(s)) return "WRONG_PHASE";
  const targetSeat = seatOf(s, cmd.targetId);
  if (targetSeat < 0) return "UNKNOWN_PLAYER";
  if (cmd.targetId === cmd.playerId) return "CANNOT_CATCH_SELF";
  const target = playerAt(s, targetSeat);
  if (target.resigned || target.hand.length !== 1 || target.unoCalled) return "NOTHING_TO_CATCH";
  const w = s.unoWindow;
  if (!w || w.playerId !== target.id || cmd.at - w.openedAt > s.config.unoWindowMs) {
    return "UNO_WINDOW_CLOSED";
  }
  events.push({ type: "UNO_CAUGHT", catcherId: cmd.playerId, targetId: target.id });
  s.unoWindow = null;
  drawCards(s, targetSeat, s.config.unoPenalty, "uno_penalty", events);
  return null;
};

const voteRematch: Handler = (s, cmd, events) => {
  if (s.phase !== "match_over") return "WRONG_PHASE";
  if (s.rematchVotes.includes(cmd.playerId)) return "ALREADY_VOTED";
  s.rematchVotes.push(cmd.playerId);
  events.push({ type: "REMATCH_VOTED", playerId: cmd.playerId });
  const active = s.players.filter((p) => !p.resigned);
  if (active.length >= 2 && active.every((p) => s.rematchVotes.includes(p.id))) {
    for (const p of s.players) {
      p.score = 0;
      p.hand = [];
      p.unoCalled = false;
    }
    s.handNumber = 0;
    s.handResults = [];
    s.summary = null;
    s.matchWinnerId = null;
    s.handWinnerId = null;
    s.rematchVotes = [];
    s.drawPile = [];
    s.discardPile = [];
    s.activeColor = null;
    s.phase = "pre_hand";
    s.dealerSeat = stepSeat(s, s.dealerSeat, 1, 1);
    events.push({ type: "REMATCH_AGREED" });
  }
  return null;
};

const resign: Handler = (s, cmd, events) => {
  if (s.phase === "match_over") return "MATCH_OVER";
  const seat = seatOf(s, cmd.playerId);
  const player = playerAt(s, seat);
  const hadTurn = isInHand(s) && seat === s.currentSeat;
  const pending = s.pendingChallenge;

  const returned = player.hand.length;
  s.drawPile.unshift(...player.hand);
  player.hand = [];
  player.resigned = true;
  player.unoCalled = false;
  if (s.unoWindow?.playerId === player.id) s.unoWindow = null;
  s.rematchVotes = s.rematchVotes.filter((id) => id !== player.id);
  events.push({ type: "PLAYER_RESIGNED", playerId: player.id, cardsReturned: returned });

  const remaining = s.players.filter((p) => !p.resigned);
  if (remaining.length < 2) {
    endMatch(s, remaining[0]?.id ?? null, "forfeit", events);
    return null;
  }
  if (!isInHand(s)) return null;

  if (s.phase === "awaiting_challenge" && pending) {
    if (pending.targetId === player.id) {
      s.pendingChallenge = null;
      advanceTurn(s, seat, 1, events);
    } else if (pending.playedById === player.id) {
      s.pendingChallenge = null;
      s.phase = "awaiting_play_or_draw";
    }
    return null;
  }
  if (hadTurn && s.phase === "awaiting_opening_color") {
    // The colour choice passes to the next player; play has not started yet.
    s.currentSeat = stepSeat(s, seat, s.direction, 1);
    events.push({
      type: "TURN_CHANGED",
      playerId: playerAt(s, s.currentSeat).id,
      direction: s.direction,
    });
    return null;
  }
  if (hadTurn) advanceTurn(s, seat, 1, events);
  return null;
};

// ------------------------------------------------------------------ dispatch

const HANDLERS: { [K in Command["type"]]: Handler<Extract<Command, { type: K }>> } = {
  START_HAND: startHandCmd,
  PLAY_CARD: playCard,
  DRAW_CARD: drawCard,
  PASS_TURN: passTurn,
  CHOOSE_COLOR: chooseColor,
  CALL_UNO: callUno,
  CATCH_UNO: catchUno,
  CHALLENGE_WILD_DRAW_FOUR: challenge,
  VOTE_REMATCH: voteRematch,
  RESIGN: resign,
  REQUEST_SNAPSHOT: () => null,
};

function rejection(
  state: GameState,
  command: unknown,
  reason: RejectReason,
): { state: GameState; events: EngineEvent[] } {
  const c = (command ?? {}) as Partial<Command>;
  return {
    state,
    events: [
      {
        type: "COMMAND_REJECTED",
        commandId: typeof c.commandId === "string" ? c.commandId : "",
        playerId: typeof c.playerId === "string" ? c.playerId : "",
        commandType: typeof c.type === "string" ? c.type : "",
        reason,
      },
    ],
  };
}

function isWellFormed(command: unknown): command is Command {
  if (typeof command !== "object" || command === null) return false;
  const c = command as Record<string, unknown>;
  return (
    typeof c.type === "string" &&
    c.type in HANDLERS &&
    typeof c.commandId === "string" &&
    c.commandId !== "" &&
    typeof c.playerId === "string" &&
    typeof c.at === "number" &&
    Number.isFinite(c.at)
  );
}

/**
 * Pure transition. On any violation the input state is returned unchanged with exactly one
 * COMMAND_REJECTED event carrying a typed reason code.
 */
export function applyCommand(
  state: GameState,
  command: Command,
): { state: GameState; events: EngineEvent[] } {
  if (!isWellFormed(command)) return rejection(state, command, "MALFORMED_COMMAND");
  if (state.seenCommandIds.includes(command.commandId))
    return rejection(state, command, "DUPLICATE_COMMAND");
  const seat = seatOf(state, command.playerId);
  if (seat < 0) return rejection(state, command, "UNKNOWN_PLAYER");
  if (playerAt(state, seat).resigned) return rejection(state, command, "PLAYER_RESIGNED");

  if (command.type === "REQUEST_SNAPSHOT") {
    return { state, events: [{ type: "SNAPSHOT_REQUESTED", playerId: command.playerId }] };
  }

  const draft = clone(state);
  const events: EngineEvent[] = [];
  const handler = HANDLERS[command.type] as Handler;
  const reason = handler(draft, command, events);
  if (reason) return rejection(state, command, reason);
  draft.seenCommandIds.push(command.commandId);
  draft.version += 1;
  return { state: draft, events };
}
