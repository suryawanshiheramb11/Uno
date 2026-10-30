import type { Variant } from "@uno/shared";
import { deckSizeOf } from "./cards";
import { seedRngState } from "./rng";
import type { Rng } from "./rng";
import { DEFAULT_CLASSIC_CONFIG, DEFAULT_NO_MERCY_EXTRAS, EngineError } from "./types";
import type { GameConfig, GameState } from "./types";

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
