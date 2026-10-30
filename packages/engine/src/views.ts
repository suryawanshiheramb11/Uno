import { getLegalMoves, isEliminated } from "./rules";
import type { EngineEvent, GameState, PlayerState, PrivateSnapshot, PublicSnapshot } from "./types";
import { EngineError } from "./types";

/** What every viewer may see. Contains no card ids from hands or the draw pile. */
export function getPublicView(state: GameState): PublicSnapshot {
  const current = state.players[state.currentSeat];
  const inPlay = state.phase !== "pre_hand" && state.phase !== "match_over";
  return {
    variant: state.variant,
    version: state.version,
    phase: state.phase,
    handNumber: state.handNumber,
    players: state.players.map((p, seat) => ({
      id: p.id,
      seat,
      handCount: p.hand.length,
      score: p.score,
      unoCalled: p.unoCalled,
      resigned: p.resigned,
      eliminated: isEliminated(state, p.id),
    })),
    currentPlayerId: inPlay && current ? current.id : null,
    direction: state.direction,
    activeColor: state.activeColor,
    topCardId: state.discardPile[state.discardPile.length - 1] ?? null,
    discardCount: state.discardPile.length,
    drawPileCount: state.drawPile.length,
    pendingChallenge: state.pendingChallenge
      ? { playedById: state.pendingChallenge.playedById, targetId: state.pendingChallenge.targetId }
      : null,
    unoWindow: state.unoWindow
      ? {
          playerId: state.unoWindow.playerId,
          closesAt: state.unoWindow.openedAt + state.config.unoWindowMs,
        }
      : null,
    handWinnerId: state.handWinnerId,
    matchWinnerId: state.matchWinnerId,
    rematchVotes: [...state.rematchVotes],
    summary: state.summary,
    pendingPenalty: state.pendingPenalty
      ? {
          ...state.pendingPenalty,
          targetId: (state.players[state.currentSeat] as { id: string }).id,
        }
      : null,
    eliminatedPlayerIds: [...state.eliminatedPlayerIds],
    swapTargetPlayerId: state.swapTargetAwaiting?.playerId ?? null,
    rouletteTargetId: state.colorRouletteActive?.targetId ?? null,
    unoPendingWindows: state.unoPending.map((w) => ({
      playerId: w.playerId,
      closesAt: w.openedAt + state.config.unoWindowMs,
    })),
  };
}

/** The public view plus this player's own hand and legal moves. Never includes anyone else's cards. */
export function getPlayerView(state: GameState, playerId: string): PrivateSnapshot {
  const seat = state.players.findIndex((p) => p.id === playerId);
  if (seat < 0) throw new EngineError("INVALID_PLAYERS", `Unknown player: ${playerId}`);
  const player = state.players[seat] as PlayerState;
  const legalMoves = getLegalMoves(state, playerId);
  return {
    ...getPublicView(state),
    selfId: player.id,
    seat,
    hand: [...player.hand],
    playableCardIds: legalMoves.flatMap((m) => (m.type === "PLAY_CARD" ? [m.cardId] : [])),
    drawnCardId: state.currentSeat === seat ? state.drawnCardId : null,
    legalMoves,
  };
}

/** Strips private card ids from events before they are sent to a given viewer. */
export function filterEventsForViewer(events: EngineEvent[], viewerId: string): EngineEvent[] {
  return events.map((e) => {
    // Color Roulette reveals its cards to the whole table; every other draw is private.
    if (e.type === "CARDS_DRAWN" && e.playerId !== viewerId && e.reason !== "color_roulette") {
      const { cardIds: _hidden, ...rest } = e;
      return rest;
    }
    return e;
  });
}
