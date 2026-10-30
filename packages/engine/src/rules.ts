import { cardDefOf, drawValue } from "./cards";
import { COLORS, IN_HAND_PHASES } from "./types";
import type { CardDef, GameState, LegalMove, PlayerState } from "./types";

export function isInHand(state: GameState): boolean {
  return IN_HAND_PHASES.includes(state.phase);
}

export function isEliminated(state: GameState, playerId: string): boolean {
  return state.eliminatedPlayerIds.includes(playerId);
}

/** Players still in the hand: not resigned and not knocked out. */
export function isActive(state: GameState, seat: number): boolean {
  const p = state.players[seat];
  return !!p && !p.resigned && !isEliminated(state, p.id);
}

export function activeSeats(state: GameState): number[] {
  const seats: number[] = [];
  state.players.forEach((_, i) => {
    if (isActive(state, i)) seats.push(i);
  });
  return seats;
}

/** Moves `n` steps from `from` in direction `dir`, skipping resigned and eliminated players. */
export function stepSeat(state: GameState, from: number, dir: 1 | -1, n: number): number {
  const total = state.players.length;
  if (activeSeats(state).length === 0) return from;
  let seat = from;
  for (let k = 0; k < n; k++) {
    do {
      seat = (seat + dir + total) % total;
    } while (!isActive(state, seat));
  }
  return seat;
}

export function topCardDef(state: GameState): CardDef | null {
  const id = state.discardPile[state.discardPile.length - 1];
  return id === undefined ? null : cardDefOf(id);
}

/** A card the player must name a colour for when playing it (every Wild except Color Roulette). */
export function needsColorChoice(def: CardDef): boolean {
  return def.color === null && def.face !== "wild_color_roulette";
}

function matchesTop(state: GameState, def: CardDef): boolean {
  if (def.color !== null && def.color === state.activeColor) return true;
  const top = topCardDef(state);
  if (!top) return false;
  if (def.face === "number") return top.face === "number" && top.value === def.value;
  return top.face === def.face;
}

/**
 * The single definition of "is this card legal right now", ignoring whose turn it is.
 * Classic: matches by colour, number or symbol; Wilds always; Wild Draw Four subject to strictWildDrawFour.
 * No Mercy: while a penalty is pending only stack cards of equal or higher value; otherwise matching,
 * with every Wild always playable.
 */
export function canPlayCard(state: GameState, player: PlayerState, cardId: string): boolean {
  const def = cardDefOf(cardId);
  if (state.variant === "no_mercy") {
    if (state.pendingPenalty) {
      const value = drawValue(def);
      return value > 0 && value >= state.pendingPenalty.topValue;
    }
    return def.color === null || matchesTop(state, def);
  }
  if (def.face === "wild") return true;
  if (def.face === "wild_draw_four") {
    if (!state.config.strictWildDrawFour) return true;
    return !player.hand.some(
      (id) =>
        id !== cardId && state.activeColor !== null && cardDefOf(id).color === state.activeColor,
    );
  }
  return matchesTop(state, def);
}

export function hasPlayableCard(state: GameState, player: PlayerState): boolean {
  return player.hand.some((id) => canPlayCard(state, player, id));
}

function playMove(cardId: string): LegalMove {
  const needs = needsColorChoice(cardDefOf(cardId));
  return { type: "PLAY_CARD", cardId, requiresColor: needs, colors: needs ? [...COLORS] : [] };
}

/**
 * The one authority on what a player may do right now. The server validates with it,
 * bots choose from it, and the UI enables buttons from it.
 */
export function getLegalMoves(state: GameState, playerId: string): LegalMove[] {
  const seat = state.players.findIndex((p) => p.id === playerId);
  if (seat < 0) return [];
  const player = state.players[seat] as PlayerState;
  if (player.resigned) return [];
  if (isInHand(state) && isEliminated(state, player.id)) return [{ type: "REQUEST_SNAPSHOT" }];
  const isCurrent = seat === state.currentSeat;
  const nm = state.variant === "no_mercy";
  const moves: LegalMove[] = [];

  switch (state.phase) {
    case "pre_hand":
    case "hand_over":
      moves.push({ type: "START_HAND" });
      break;
    case "match_over":
      if (!state.rematchVotes.includes(player.id)) moves.push({ type: "VOTE_REMATCH" });
      break;
    case "awaiting_opening_color":
    case "awaiting_roulette_color":
      if (isCurrent) for (const color of COLORS) moves.push({ type: "CHOOSE_COLOR", color });
      break;
    case "awaiting_swap_target":
      if (isCurrent) {
        for (const other of activeSeats(state)) {
          if (other !== seat) {
            moves.push({
              type: "CHOOSE_SWAP_TARGET",
              targetId: (state.players[other] as PlayerState).id,
            });
          }
        }
      }
      break;
    case "awaiting_play_or_draw": {
      if (!isCurrent) break;
      let anyPlay = false;
      for (const id of player.hand) {
        if (canPlayCard(state, player, id)) {
          moves.push(playMove(id));
          anyPlay = true;
        }
      }
      // No Mercy: you may only draw when you have nothing to play.
      if (!nm || !anyPlay) moves.push({ type: "DRAW_CARD" });
      break;
    }
    case "facing_penalty":
      if (isCurrent) {
        for (const id of player.hand) if (canPlayCard(state, player, id)) moves.push(playMove(id));
        moves.push({ type: "DRAW_CARD" });
      }
      break;
    case "play_or_draw":
      if (isCurrent) {
        if (state.drawnCardId && canPlayCard(state, player, state.drawnCardId)) {
          moves.push(playMove(state.drawnCardId));
        }
        // In No Mercy the card drawn-until-playable must be played.
        if (!nm) moves.push({ type: "PASS_TURN" });
      }
      break;
    case "awaiting_challenge":
      if (isCurrent) moves.push({ type: "CHALLENGE_WILD_DRAW_FOUR" }, { type: "DRAW_CARD" });
      break;
  }

  if (isInHand(state)) {
    if (player.hand.length === 1 && !player.unoCalled) moves.push({ type: "CALL_UNO" });
    const windows = [...(state.unoWindow ? [state.unoWindow] : []), ...state.unoPending];
    const seen = new Set<string>();
    for (const w of windows) {
      if (w.playerId === player.id || seen.has(w.playerId)) continue;
      const target = state.players.find((p) => p.id === w.playerId);
      if (
        target &&
        isActive(state, state.players.indexOf(target)) &&
        target.hand.length === 1 &&
        !target.unoCalled
      ) {
        seen.add(target.id);
        moves.push({ type: "CATCH_UNO", targetId: target.id });
      }
    }
  }
  if (state.phase !== "match_over") moves.push({ type: "RESIGN" });
  moves.push({ type: "REQUEST_SNAPSHOT" });
  return moves;
}
