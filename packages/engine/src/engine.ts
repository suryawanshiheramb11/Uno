import type { Variant } from "@uno/shared";
import { cardDefOf, cardPoints, deckSizeOf, drawValue, isValidCardId, makeCardId } from "./cards";
import { nextUint32, seedRngState, shuffleInPlace } from "./rng";
import type { Rng } from "./rng";
import {
  activeSeats,
  canPlayCard,
  hasPlayableCard,
  isActive,
  isEliminated,
  isInHand,
  needsColorChoice,
  stepSeat,
} from "./rules";
import { COLORS, DEFAULT_CLASSIC_CONFIG, DEFAULT_NO_MERCY_EXTRAS, EngineError } from "./types";
import type {
  CardDef,
  Color,
  Command,
  DrawReason,
  EndReason,
  EngineEvent,
  GameConfig,
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

/** Points awarded to the winner of a No Mercy hand for each player knocked out during it. */
const KNOCKOUT_BONUS = 250;

// ------------------------------------------------------------------ creation

export function createInitialState(
  variant: Variant,
  playerIds: string[],
  config: Partial<GameConfig>,
  rng: Rng,
): GameState {
  if (variant !== "classic" && variant !== "no_mercy") {
    throw new EngineError("UNSUPPORTED_VARIANT", `Unknown variant: ${String(variant)}`);
  }
  if (
    !Array.isArray(playerIds) ||
    playerIds.length < 2 ||
    playerIds.length > 10 ||
    playerIds.some((id) => typeof id !== "string" || id === "") ||
    new Set(playerIds).size !== playerIds.length
  ) {
    throw new EngineError("INVALID_PLAYERS", "A game needs 2-10 unique, non-empty player ids");
  }
  const merged: GameConfig = {
    ...DEFAULT_CLASSIC_CONFIG,
    ...(variant === "no_mercy" ? DEFAULT_NO_MERCY_EXTRAS : {}),
    ...config,
  };
  if (
    merged.initialHandSize < 1 ||
    merged.initialHandSize * playerIds.length >= deckSizeOf(variant) - 8 ||
    merged.unoWindowMs < 0 ||
    merged.unoPenalty < 0 ||
    (merged.mercyThreshold !== undefined && merged.mercyThreshold <= merged.initialHandSize)
  ) {
    throw new EngineError("INVALID_CONFIG", "Config values out of range");
  }
  return {
    variant,
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
    pendingPenalty: null,
    eliminatedPlayerIds: [],
    swapTargetAwaiting: null,
    colorRouletteActive: null,
    unoPending: [],
  };
}

// ------------------------------------------------------------------ helpers

function playerAt(s: GameState, seat: number): PlayerState {
  return s.players[seat] as PlayerState;
}

function seatOf(s: GameState, id: string): number {
  return s.players.findIndex((p) => p.id === id);
}

const isNoMercy = (s: GameState): boolean => s.variant === "no_mercy";
const handEnded = (s: GameState): boolean => s.phase === "hand_over" || s.phase === "match_over";
const mercyThreshold = (s: GameState): number =>
  s.config.mercyThreshold ?? DEFAULT_NO_MERCY_EXTRAS.mercyThreshold;

function clearUnoFor(s: GameState, playerId: string): void {
  if (s.unoWindow?.playerId === playerId) s.unoWindow = null;
  s.unoPending = s.unoPending.filter((w) => w.playerId !== playerId);
}

function reshuffleIfNeeded(s: GameState, events: Events): void {
  if (s.drawPile.length > 0 || s.discardPile.length <= 1) return;
  const top = s.discardPile.pop() as string;
  s.drawPile = s.discardPile;
  s.discardPile = [top];
  shuffleInPlace(s.drawPile, s.rngState);
  events.push({ type: "DRAW_PILE_RESHUFFLED", cardCount: s.drawPile.length });
}

/** No Mercy: a hand at or above the threshold knocks its owner out. */
function atMercyLimit(s: GameState, player: PlayerState): boolean {
  return isNoMercy(s) && player.hand.length >= mercyThreshold(s) && !isEliminated(s, player.id);
}

/**
 * Eliminates a player: their hand is shuffled back into the draw pile. If one player is left
 * standing the hand ends immediately with them as the winner.
 */
function eliminate(s: GameState, seat: number, events: Events): void {
  const player = playerAt(s, seat);
  const returned = player.hand.length;
  s.drawPile.push(...player.hand);
  player.hand = [];
  shuffleInPlace(s.drawPile, s.rngState);
  player.unoCalled = false;
  clearUnoFor(s, player.id);
  s.eliminatedPlayerIds.push(player.id);
  events.push({ type: "PLAYER_ELIMINATED", playerId: player.id, cardsReturned: returned });
  const remaining = activeSeats(s);
  if (remaining.length === 1) endHand(s, remaining[0] as number, events, "last_standing");
}

/**
 * Draws up to `count` cards. In No Mercy the drawer is eliminated the moment their hand reaches the
 * mercy threshold, which also stops the draw. Callers check `isEliminated` / `handEnded` afterwards.
 */
function drawCards(
  s: GameState,
  seat: number,
  count: number,
  reason: DrawReason,
  events: Events,
): string[] {
  const player = playerAt(s, seat);
  const drawn: string[] = [];
  let knockedOut = false;
  for (let i = 0; i < count; i++) {
    reshuffleIfNeeded(s, events);
    const id = s.drawPile.pop();
    if (id === undefined) break;
    player.hand.push(id);
    drawn.push(id);
    if (atMercyLimit(s, player)) {
      knockedOut = true;
      break;
    }
  }
  if (player.hand.length >= 2) {
    player.unoCalled = false;
    clearUnoFor(s, player.id);
  }
  events.push({
    type: "CARDS_DRAWN",
    playerId: player.id,
    count: drawn.length,
    cardIds: drawn,
    reason,
  });
  if (knockedOut) eliminate(s, seat, events);
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
  s.unoPending = s.unoPending.filter((w) => w.playerId === actorId);
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
    variant: s.variant,
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

function clearVariantState(s: GameState): void {
  s.pendingChallenge = null;
  s.unoWindow = null;
  s.unoPending = [];
  s.drawnCardId = null;
  s.pendingPenalty = null;
  s.swapTargetAwaiting = null;
  s.colorRouletteActive = null;
}

function endMatch(s: GameState, winnerId: string | null, reason: EndReason, events: Events): void {
  s.phase = "match_over";
  s.matchWinnerId = winnerId;
  clearVariantState(s);
  s.summary = buildSummary(s, winnerId, reason);
  events.push({ type: "MATCH_ENDED", summary: clone(s.summary) });
}

function endHand(
  s: GameState,
  winnerSeat: number,
  events: Events,
  reason: EndReason = "hand_empty",
): void {
  const winner = playerAt(s, winnerSeat);
  let points = 0;
  s.players.forEach((p, seat) => {
    if (seat === winnerSeat || p.resigned) return;
    for (const id of p.hand) points += cardPoints(cardDefOf(id));
  });
  if (isNoMercy(s)) points += KNOCKOUT_BONUS * s.eliminatedPlayerIds.length;
  winner.score += points;
  s.handWinnerId = winner.id;
  s.handResults.push({ hand: s.handNumber, winnerId: winner.id, points });
  clearVariantState(s);
  const scores: Record<string, number> = {};
  for (const p of s.players) scores[p.id] = p.score;
  events.push({ type: "HAND_WON", winnerId: winner.id, points, scores });
  const target = s.config.targetScore;
  if (target === null) endMatch(s, winner.id, reason, events);
  else if (winner.score >= target) endMatch(s, winner.id, "points_target", events);
  else s.phase = "hand_over";
}

// ------------------------------------------------------------------ dealing

function startHand(s: GameState, events: Events): void {
  const nm = isNoMercy(s);
  s.handNumber += 1;
  s.handSeed = nextUint32(s.rngState);
  s.drawPile = Array.from({ length: deckSizeOf(s.variant) }, (_, i) =>
    makeCardId(s.handSeed, i, s.variant),
  );
  shuffleInPlace(s.drawPile, s.rngState);
  s.discardPile = [];
  for (const p of s.players) {
    p.hand = [];
    p.unoCalled = false;
  }
  s.direction = 1;
  s.pendingChallenge = null;
  s.unoWindow = null;
  s.unoPending = [];
  s.drawnCardId = null;
  s.handWinnerId = null;
  s.rematchVotes = [];
  s.pendingPenalty = null;
  s.eliminatedPlayerIds = [];
  s.swapTargetAwaiting = null;
  s.colorRouletteActive = null;
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

  let opening = s.drawPile.pop() as string;
  if (nm) {
    // No Mercy: the opening card is always a number; anything else goes to the bottom of the pile.
    for (let guard = 0; cardDefOf(opening).face !== "number" && guard < 200; guard++) {
      events.push({ type: "OPENING_CARD_RESHUFFLED", cardId: opening });
      s.drawPile.unshift(opening);
      opening = s.drawPile.pop() as string;
    }
  } else {
    // Classic: a Wild Draw Four is shuffled back and replaced.
    for (let guard = 0; cardDefOf(opening).face === "wild_draw_four" && guard < 100; guard++) {
      events.push({ type: "OPENING_CARD_RESHUFFLED", cardId: opening });
      s.drawPile.push(opening);
      shuffleInPlace(s.drawPile, s.rngState);
      opening = s.drawPile.pop() as string;
    }
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

// ------------------------------------------------------------------ hand changes (7 and 0)

/**
 * After a swap or rotation, anyone left holding exactly one card must call UNO: they get a window
 * in which anyone may catch them, and their called-UNO flag starts fresh.
 */
function refreshUnoAfterHandChange(s: GameState, seats: number[], at: number): void {
  for (const seat of seats) {
    const p = playerAt(s, seat);
    p.unoCalled = false;
    clearUnoFor(s, p.id);
  }
  for (const seat of seats) {
    const p = playerAt(s, seat);
    if (p.hand.length === 1) s.unoPending.push({ playerId: p.id, openedAt: at });
  }
}

function swapHands(s: GameState, aSeat: number, bSeat: number, at: number, events: Events): void {
  const a = playerAt(s, aSeat);
  const b = playerAt(s, bSeat);
  [a.hand, b.hand] = [b.hand, a.hand];
  events.push({ type: "HANDS_SWAPPED", a: a.id, b: b.id });
  refreshUnoAfterHandChange(s, [aSeat, bSeat], at);
}

/** Every active player passes their whole hand to the next player in the current direction. */
function rotateHands(s: GameState, fromSeat: number, at: number, events: Events): void {
  const count = activeSeats(s).length;
  const order: number[] = [fromSeat];
  for (let i = 1; i < count; i++) {
    order.push(stepSeat(s, order[i - 1] as number, s.direction, 1));
  }
  const before = order.map((o) => playerAt(s, o).hand);
  order.forEach((_, i) => {
    playerAt(s, order[(i + 1) % count] as number).hand = before[i] as string[];
  });
  const deltas: Record<string, number> = {};
  order.forEach((o, i) => {
    deltas[playerAt(s, o).id] = playerAt(s, o).hand.length - (before[i] as string[]).length;
  });
  events.push({ type: "HANDS_ROTATED", direction: s.direction, deltas });
  refreshUnoAfterHandChange(s, order, at);
}

/**
 * Adds a played penalty card to the stack and hands the decision to the next player.
 * A Wild Reverse Draw Four reverses first; with two players that reverse acts as a skip, so the
 * player who played it faces the penalty themselves (and may stack it back).
 * Returns nothing to advance: control is already with the penalty's target.
 */
function stackPenalty(
  s: GameState,
  seat: number,
  def: CardDef,
  won: boolean,
  events: Events,
): void {
  const value = drawValue(def);
  if (def.face === "wild_reverse_draw_four") {
    s.direction = s.direction === 1 ? -1 : 1;
    events.push({ type: "DIRECTION_REVERSED", direction: s.direction });
  }
  const total = (s.pendingPenalty?.total ?? 0) + value;
  if (won) {
    // Going out with a penalty card: the next player takes the whole stack for scoring, no reply.
    s.pendingPenalty = null;
    drawCards(s, stepSeat(s, seat, s.direction, 1), total, "penalty", events);
    return;
  }
  const victim =
    def.face === "wild_reverse_draw_four" && activeSeats(s).length === 2
      ? seat
      : stepSeat(s, seat, s.direction, 1);
  s.pendingPenalty = { total, topValue: value };
  s.currentSeat = victim;
  s.phase = "facing_penalty";
  events.push({
    type: "PENALTY_PENDING",
    playerId: playerAt(s, victim).id,
    total,
    topValue: value,
  });
  events.push({ type: "TURN_CHANGED", playerId: playerAt(s, victim).id, direction: s.direction });
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
  if (s.phase === "awaiting_opening_color" || s.phase === "awaiting_roulette_color") {
    return "COLOR_CHOICE_PENDING";
  }
  if (s.phase === "awaiting_swap_target") return "SWAP_TARGET_PENDING";
  const player = playerAt(s, seat);
  if (!isValidCardId(cmd.cardId) || !player.hand.includes(cmd.cardId)) return "CARD_NOT_IN_HAND";
  if (s.phase === "play_or_draw" && cmd.cardId !== s.drawnCardId) return "NOT_DRAWN_CARD";
  const def = cardDefOf(cmd.cardId);
  if (!canPlayCard(s, player, cmd.cardId)) {
    if (s.phase === "facing_penalty")
      return drawValue(def) > 0 ? "STACK_TOO_LOW" : "MUST_STACK_OR_DRAW";
    return def.face === "wild_draw_four" ? "WILD_DRAW_FOUR_ILLEGAL" : "CARD_NOT_PLAYABLE";
  }
  let chosen: Color | null = null;
  if (needsColorChoice(def)) {
    if (cmd.color === undefined) return "COLOR_REQUIRED";
    if (!COLORS.includes(cmd.color)) return "COLOR_INVALID";
    chosen = cmd.color;
  }

  const nm = isNoMercy(s);
  const previousColor = s.activeColor as Color;
  closeUnoWindowForOthers(s, player.id);
  player.hand.splice(player.hand.indexOf(cmd.cardId), 1);
  // Discard All: every other card of its colour goes down with it, underneath.
  let extras: string[] = [];
  if (def.face === "discard_all") {
    extras = player.hand.filter((id) => cardDefOf(id).color === def.color);
    player.hand = player.hand.filter((id) => !extras.includes(id));
    s.discardPile.push(...extras);
  }
  s.discardPile.push(cmd.cardId);
  s.drawnCardId = null;
  s.activeColor = def.color ?? chosen ?? s.activeColor;
  events.push({
    type: "CARD_PLAYED",
    playerId: player.id,
    cardId: cmd.cardId,
    chosenColor: chosen,
  });
  if (extras.length > 0)
    events.push({ type: "CARDS_DISCARDED", playerId: player.id, cardIds: extras });
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
      if (nm && (s.config.sevenZeroRules ?? true) && !won) {
        if (def.value === 7) {
          s.swapTargetAwaiting = { playerId: player.id };
          s.phase = "awaiting_swap_target";
          events.push({ type: "SWAP_TARGET_REQUESTED", playerId: player.id });
          advance = null;
        } else if (def.value === 0) {
          rotateHands(s, seat, cmd.at, events);
        }
      }
      break;
    case "wild":
    case "discard_all":
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
      if (nm) {
        stackPenalty(s, seat, def, won, events);
        advance = null;
        break;
      }
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
    case "draw_four":
    case "wild_reverse_draw_four":
    case "wild_draw_six":
    case "wild_draw_ten":
      stackPenalty(s, seat, def, won, events);
      advance = null;
      break;
    case "skip_everyone": {
      if (!won) {
        let other = stepSeat(s, seat, s.direction, 1);
        while (other !== seat) {
          events.push({
            type: "PLAYER_SKIPPED",
            playerId: playerAt(s, other).id,
            reason: "skip_everyone",
          });
          other = stepSeat(s, other, s.direction, 1);
        }
      }
      advance = 0;
      break;
    }
    case "wild_color_roulette": {
      if (!won) {
        const target = stepSeat(s, seat, s.direction, 1);
        s.colorRouletteActive = { playedById: player.id, targetId: playerAt(s, target).id };
        s.currentSeat = target;
        s.phase = "awaiting_roulette_color";
        events.push({
          type: "ROULETTE_STARTED",
          playerId: player.id,
          targetId: playerAt(s, target).id,
        });
        events.push({
          type: "TURN_CHANGED",
          playerId: playerAt(s, target).id,
          direction: s.direction,
        });
        advance = null;
      }
      break;
    }
  }
  if (won) {
    if (!handEnded(s)) endHand(s, seat, events);
    return null;
  }
  if (handEnded(s)) return null;
  if (advance !== null) advanceTurn(s, seat, advance, events);
  return null;
};

const drawCard: Handler = (s, cmd, events) => {
  const gate = phaseRejection(s);
  if (gate) return gate;
  const seat = seatOf(s, cmd.playerId);
  if (seat !== s.currentSeat) return "NOT_YOUR_TURN";
  if (s.phase === "awaiting_opening_color" || s.phase === "awaiting_roulette_color") {
    return "COLOR_CHOICE_PENDING";
  }
  if (s.phase === "awaiting_swap_target") return "SWAP_TARGET_PENDING";
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
  if (s.phase === "facing_penalty") {
    // Taking the whole stack ends the turn.
    const total = s.pendingPenalty?.total ?? 0;
    s.pendingPenalty = null;
    drawCards(s, seat, total, "penalty", events);
    if (handEnded(s)) return null;
    advanceTurn(s, seat, 1, events);
    return null;
  }
  if (isNoMercy(s)) {
    if (hasPlayableCard(s, player)) return "CANNOT_DRAW_WITH_PLAYABLE";
    // Draw until you can play: the first playable card drawn becomes the only legal move.
    for (;;) {
      reshuffleIfNeeded(s, events);
      const id = s.drawPile.pop();
      if (id === undefined) {
        advanceTurn(s, seat, 1, events);
        break;
      }
      player.hand.push(id);
      player.unoCalled = false;
      clearUnoFor(s, player.id);
      events.push({
        type: "CARDS_DRAWN",
        playerId: player.id,
        count: 1,
        cardIds: [id],
        reason: "draw_until_play",
      });
      if (atMercyLimit(s, player)) {
        eliminate(s, seat, events);
        if (!handEnded(s)) advanceTurn(s, seat, 1, events);
        break;
      }
      if (canPlayCard(s, player, id)) {
        s.phase = "play_or_draw";
        s.drawnCardId = id;
        break;
      }
    }
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
  if (s.phase === "awaiting_opening_color" || s.phase === "awaiting_roulette_color") {
    return "COLOR_CHOICE_PENDING";
  }
  if (s.phase === "awaiting_swap_target") return "SWAP_TARGET_PENDING";
  if (s.phase === "facing_penalty") return "MUST_STACK_OR_DRAW";
  if (s.phase === "awaiting_play_or_draw") return "NOTHING_TO_PASS";
  if (isNoMercy(s)) return "MUST_PLAY_DRAWN_CARD";
  closeUnoWindowForOthers(s, cmd.playerId);
  events.push({ type: "TURN_PASSED", playerId: cmd.playerId });
  advanceTurn(s, seat, 1, events);
  return null;
};

const chooseColor: Handler<Extract<Command, { type: "CHOOSE_COLOR" }>> = (s, cmd, events) => {
  if (s.phase !== "awaiting_opening_color" && s.phase !== "awaiting_roulette_color") {
    return "WRONG_PHASE";
  }
  const seat = seatOf(s, cmd.playerId);
  if (seat !== s.currentSeat) return "NOT_YOUR_TURN";
  if (!COLORS.includes(cmd.color)) return "COLOR_INVALID";
  s.activeColor = cmd.color;
  events.push({ type: "COLOR_CHOSEN", playerId: cmd.playerId, color: cmd.color });
  if (s.phase === "awaiting_opening_color") {
    s.phase = "awaiting_play_or_draw";
    return null;
  }

  // Color Roulette: reveal cards one at a time until one of the chosen colour (Wilds never match).
  const player = playerAt(s, seat);
  closeUnoWindowForOthers(s, player.id);
  for (;;) {
    reshuffleIfNeeded(s, events);
    const id = s.drawPile.pop();
    if (id === undefined) break;
    player.hand.push(id);
    player.unoCalled = false;
    clearUnoFor(s, player.id);
    events.push({
      type: "CARDS_DRAWN",
      playerId: player.id,
      count: 1,
      cardIds: [id],
      reason: "color_roulette",
    });
    if (atMercyLimit(s, player)) {
      eliminate(s, seat, events);
      break;
    }
    if (cardDefOf(id).color === cmd.color) break;
  }
  s.colorRouletteActive = null;
  if (handEnded(s)) return null;
  advanceTurn(s, seat, 1, events);
  return null;
};

const chooseSwapTarget: Handler<Extract<Command, { type: "CHOOSE_SWAP_TARGET" }>> = (
  s,
  cmd,
  events,
) => {
  if (s.phase !== "awaiting_swap_target" || !s.swapTargetAwaiting) return "NO_SWAP_PENDING";
  const seat = seatOf(s, cmd.playerId);
  if (seat !== s.currentSeat) return "NOT_YOUR_TURN";
  const targetSeat = typeof cmd.targetId === "string" ? seatOf(s, cmd.targetId) : -1;
  if (targetSeat < 0 || targetSeat === seat || !isActive(s, targetSeat))
    return "INVALID_SWAP_TARGET";
  s.swapTargetAwaiting = null;
  swapHands(s, seat, targetSeat, cmd.at, events);
  advanceTurn(s, seat, 1, events);
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
  clearUnoFor(s, player.id);
  events.push({ type: "UNO_CALLED", playerId: player.id });
  return null;
};

const catchUno: Handler<Extract<Command, { type: "CATCH_UNO" }>> = (s, cmd, events) => {
  if (!isInHand(s)) return "WRONG_PHASE";
  const targetSeat = seatOf(s, cmd.targetId);
  if (targetSeat < 0) return "UNKNOWN_PLAYER";
  if (cmd.targetId === cmd.playerId) return "CANNOT_CATCH_SELF";
  const target = playerAt(s, targetSeat);
  if (!isActive(s, targetSeat) || target.hand.length !== 1 || target.unoCalled) {
    return "NOTHING_TO_CATCH";
  }
  const w =
    s.unoWindow?.playerId === target.id
      ? s.unoWindow
      : s.unoPending.find((x) => x.playerId === target.id);
  if (!w || cmd.at - w.openedAt > s.config.unoWindowMs) return "UNO_WINDOW_CLOSED";
  events.push({ type: "UNO_CAUGHT", catcherId: cmd.playerId, targetId: target.id });
  clearUnoFor(s, target.id);
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
    s.eliminatedPlayerIds = [];
    clearVariantState(s);
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
  clearUnoFor(s, player.id);
  s.rematchVotes = s.rematchVotes.filter((id) => id !== player.id);
  events.push({ type: "PLAYER_RESIGNED", playerId: player.id, cardsReturned: returned });

  const remaining = s.players.filter((p) => !p.resigned && !isEliminated(s, p.id));
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
  if (hadTurn) {
    // Anything the resigner was facing (a stacked penalty, a swap choice, a roulette) is voided.
    s.pendingPenalty = null;
    s.swapTargetAwaiting = null;
    s.colorRouletteActive = null;
    advanceTurn(s, seat, 1, events);
  }
  return null;
};

// ------------------------------------------------------------------ dispatch

const HANDLERS: { [K in Command["type"]]: Handler<Extract<Command, { type: K }>> } = {
  START_HAND: startHandCmd,
  PLAY_CARD: playCard,
  DRAW_CARD: drawCard,
  PASS_TURN: passTurn,
  CHOOSE_COLOR: chooseColor,
  CHOOSE_SWAP_TARGET: chooseSwapTarget,
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
  if (state.seenCommandIds.includes(command.commandId)) {
    return rejection(state, command, "DUPLICATE_COMMAND");
  }
  const seat = seatOf(state, command.playerId);
  if (seat < 0) return rejection(state, command, "UNKNOWN_PLAYER");
  if (playerAt(state, seat).resigned) return rejection(state, command, "PLAYER_RESIGNED");

  if (command.type === "REQUEST_SNAPSHOT") {
    return { state, events: [{ type: "SNAPSHOT_REQUESTED", playerId: command.playerId }] };
  }
  // Knocked-out players may watch but cannot act until the next hand.
  if (isInHand(state) && isEliminated(state, command.playerId)) {
    return rejection(state, command, "PLAYER_ELIMINATED");
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
