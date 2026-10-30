import { cardDefOf } from "./cards";
import { COLORS, IN_HAND_PHASES } from "./types";
import type { CardDef, GameState, LegalMove, PlayerState } from "./types";

export function isInHand(state: GameState): boolean {
  return IN_HAND_PHASES.includes(state.phase);
}

export function activeSeats(state: GameState): number[] {
  const seats: number[] = [];
  state.players.forEach((p, i) => {
    if (!p.resigned) seats.push(i);
  });
  return seats;
}

/** Moves `n` steps from `from` in direction `dir`, skipping resigned players. */
export function stepSeat(state: GameState, from: number, dir: 1 | -1, n: number): number {
  const total = state.players.length;
  if (activeSeats(state).length === 0) return from;
  let seat = from;
  for (let k = 0; k < n; k++) {
    do {
      seat = (seat + dir + total) % total;
    } while ((state.players[seat] as PlayerState).resigned);
  }
  return seat;
}

export function topCardDef(state: GameState): CardDef | null {
  const id = state.discardPile[state.discardPile.length - 1];
  return id === undefined ? null : cardDefOf(id);
}

/**
 * The single definition of "is this card legal right now", ignoring whose turn it is.
 * Matches by colour, number or symbol; Wilds always; Wild Draw Four is subject to strictWildDrawFour.
 */
export function canPlayCard(state: GameState, player: PlayerState, cardId: string): boolean {
  const def = cardDefOf(cardId);
  if (def.face === "wild") return true;
  if (def.face === "wild_draw_four") {
    if (!state.config.strictWildDrawFour) return true;
    return !player.hand.some(
      (id) =>
        id !== cardId && state.activeColor !== null && cardDefOf(id).color === state.activeColor,
    );
  }
  if (def.color !== null && def.color === state.activeColor) return true;
  const top = topCardDef(state);
  if (!top) return false;
  if (def.face === "number") return top.face === "number" && top.value === def.value;
  return top.face === def.face;
}

function playMove(cardId: string): LegalMove {
  const wild = cardDefOf(cardId).color === null;
  return { type: "PLAY_CARD", cardId, requiresColor: wild, colors: wild ? [...COLORS] : [] };
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
  const isCurrent = seat === state.currentSeat;
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
      if (isCurrent) for (const color of COLORS) moves.push({ type: "CHOOSE_COLOR", color });
      break;
    case "awaiting_play_or_draw":
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
        moves.push({ type: "PASS_TURN" });
      }
      break;
    case "awaiting_challenge":
      if (isCurrent) moves.push({ type: "CHALLENGE_WILD_DRAW_FOUR" }, { type: "DRAW_CARD" });
      break;
  }

  if (isInHand(state)) {
    if (player.hand.length === 1 && !player.unoCalled) moves.push({ type: "CALL_UNO" });
    const w = state.unoWindow;
    if (w && w.playerId !== player.id) {
      const target = state.players.find((p) => p.id === w.playerId);
      if (target && !target.resigned && target.hand.length === 1 && !target.unoCalled) {
        moves.push({ type: "CATCH_UNO", targetId: target.id });
      }
    }
  }
  if (state.phase !== "match_over") moves.push({ type: "RESIGN" });
  moves.push({ type: "REQUEST_SNAPSHOT" });
  return moves;
}
