import { cardDefOf, cardPoints, deckSizeOf, drawValue, makeCardId } from "./cards";
import { nextUint32, shuffleInPlace } from "./rng";
import { activeSeats, isEliminated, stepSeat } from "./rules";
import { DEFAULT_NO_MERCY_EXTRAS } from "./types";
import type {
  CardDef,
  DrawReason,
  EndReason,
  EngineEvent,
  GameState,
  MatchSummary,
  PlayerState,
} from "./types";

export type Events = EngineEvent[];

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Points awarded to the winner of a No Mercy hand for each player knocked out during it. */
export const KNOCKOUT_BONUS = 250;

// ------------------------------------------------------------------ helpers

export function playerAt(s: GameState, seat: number): PlayerState {
  return s.players[seat] as PlayerState;
}

export function seatOf(s: GameState, id: string): number {
  return s.players.findIndex((p) => p.id === id);
}

export const isNoMercy = (s: GameState): boolean => s.variant === "no_mercy";
export const handEnded = (s: GameState): boolean =>
  s.phase === "hand_over" || s.phase === "match_over";
export const mercyThreshold = (s: GameState): number =>
  s.config.mercyThreshold ?? DEFAULT_NO_MERCY_EXTRAS.mercyThreshold;

export function clearUnoFor(s: GameState, playerId: string): void {
  if (s.unoWindow?.playerId === playerId) s.unoWindow = null;
  s.unoPending = s.unoPending.filter((w) => w.playerId !== playerId);
}

export function reshuffleIfNeeded(s: GameState, events: Events): void {
  if (s.drawPile.length > 0 || s.discardPile.length <= 1) return;
  const top = s.discardPile.pop() as string;
  s.drawPile = s.discardPile;
  s.discardPile = [top];
  shuffleInPlace(s.drawPile, s.rngState);
  events.push({ type: "DRAW_PILE_RESHUFFLED", cardCount: s.drawPile.length });
}

/** No Mercy: a hand at or above the threshold knocks its owner out. */
export function atMercyLimit(s: GameState, player: PlayerState): boolean {
  return isNoMercy(s) && player.hand.length >= mercyThreshold(s) && !isEliminated(s, player.id);
}

/**
 * Eliminates a player: their hand is shuffled back into the draw pile. If one player is left
 * standing the hand ends immediately with them as the winner.
 */
export function eliminate(s: GameState, seat: number, events: Events): void {
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
export function drawCards(
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

export function advanceTurn(s: GameState, from: number, steps: number, events: Events): void {
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
export function closeUnoWindowForOthers(s: GameState, actorId: string): void {
  if (s.unoWindow && s.unoWindow.playerId !== actorId) s.unoWindow = null;
  s.unoPending = s.unoPending.filter((w) => w.playerId === actorId);
}

export function buildSummary(
  s: GameState,
  winnerId: string | null,
  endReason: EndReason,
): MatchSummary {
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

export function clearVariantState(s: GameState): void {
  s.pendingChallenge = null;
  s.unoWindow = null;
  s.unoPending = [];
  s.drawnCardId = null;
  s.pendingPenalty = null;
  s.swapTargetAwaiting = null;
  s.colorRouletteActive = null;
}

export function endMatch(
  s: GameState,
  winnerId: string | null,
  reason: EndReason,
  events: Events,
): void {
  s.phase = "match_over";
  s.matchWinnerId = winnerId;
  clearVariantState(s);
  s.summary = buildSummary(s, winnerId, reason);
  events.push({ type: "MATCH_ENDED", summary: clone(s.summary) });
}

export function endHand(
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

export function startHand(s: GameState, events: Events): void {
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
export function refreshUnoAfterHandChange(s: GameState, seats: number[], at: number): void {
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

export function swapHands(
  s: GameState,
  aSeat: number,
  bSeat: number,
  at: number,
  events: Events,
): void {
  const a = playerAt(s, aSeat);
  const b = playerAt(s, bSeat);
  [a.hand, b.hand] = [b.hand, a.hand];
  events.push({ type: "HANDS_SWAPPED", a: a.id, b: b.id });
  refreshUnoAfterHandChange(s, [aSeat, bSeat], at);
}

/** Every active player passes their whole hand to the next player in the current direction. */
export function rotateHands(s: GameState, fromSeat: number, at: number, events: Events): void {
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
export function stackPenalty(
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
