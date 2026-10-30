import type { Variant } from "@uno/shared";
import { expect } from "vitest";
import { cardDefOf } from "./cards";
import { createInitialState } from "./state";
import { applyCommand } from "./commands";
import { createRng } from "./rng";
import { canPlayCard, getLegalMoves, isInHand, needsColorChoice } from "./rules";
import { cmd, expectConserved } from "./test-helpers";
import type {
  Color,
  Command,
  EngineEvent,
  GameConfig,
  GameState,
  LegalMove,
  UnoWindow,
} from "./types";

export interface GameLog {
  initial: GameState;
  states: GameState[];
  events: EngineEvent[];
  commands: Command[];
  final: GameState;
  steps: number;
}

const PLAY_PHASES = ["awaiting_play_or_draw", "play_or_draw", "facing_penalty"];

/** After every accepted command: every card accounted for once, and legality is self-consistent. */
export function checkInvariants(state: GameState): void {
  if (state.phase === "pre_hand") return;
  expectConserved(state);
  if (!isInHand(state)) return;
  const current = state.players[state.currentSeat];
  if (!current || !PLAY_PHASES.includes(state.phase)) return;
  const legal = new Set(
    getLegalMoves(state, current.id).flatMap((m: LegalMove) =>
      m.type === "PLAY_CARD" ? [m.cardId] : [],
    ),
  );
  for (const id of current.hand) {
    const res = applyCommand(
      state,
      cmd(
        "PLAY_CARD",
        current.id,
        needsColorChoice(cardDefOf(id)) ? { cardId: id, color: "red" } : { cardId: id },
      ),
    );
    const accepted = res.events[0]?.type !== "COMMAND_REJECTED";
    expect(accepted, `card ${id} legal=${legal.has(id)} phase=${state.phase}`).toBe(legal.has(id));
    if (state.phase === "awaiting_play_or_draw" || state.phase === "facing_penalty") {
      expect(canPlayCard(state, current, id)).toBe(legal.has(id));
    }
  }
}

export interface RandomGameOptions {
  maxSteps?: number;
  check?: boolean;
  onStep?: () => void;
  config?: Partial<GameConfig>;
  variant?: Variant;
  /** Player count; default cycles 2-6 with the seed. */
  players?: number;
  /** Continue a prepared game instead of dealing a new hand. */
  initial?: GameState;
}

export function playRandomGame(seed: number, opts: RandomGameOptions = {}): GameLog {
  const variant = opts.variant ?? "classic";
  const n = opts.players ?? 2 + (seed % 5);
  const ids = opts.initial
    ? opts.initial.players.map((p) => p.id)
    : Array.from({ length: n }, (_, i) => `p${i}`);
  const config: Partial<GameConfig> =
    opts.config ?? (variant === "classic" && seed % 3 === 0 ? { strictWildDrawFour: true } : {});
  const policy = createRng(seed * 7919 + 13);
  const initial = opts.initial ?? createInitialState(variant, ids, config, createRng(seed));
  let state = initial;
  const states: GameState[] = [state];
  const events: EngineEvent[] = [];
  const commands: Command[] = [];
  let clock = 0;

  const send = (raw: Command) => {
    // Deterministic ids so identical seeds give byte-identical logs.
    const c = { ...raw, commandId: `s${seed}-${commands.length}` } as Command;
    const res = applyCommand(state, c);
    const rejected = res.events.find((e) => e.type === "COMMAND_REJECTED");
    if (rejected)
      throw new Error(`seed ${seed}: ${JSON.stringify(c)} rejected: ${JSON.stringify(rejected)}`);
    state = res.state;
    states.push(state);
    events.push(...res.events);
    commands.push(c);
    if (opts.check !== false) checkInvariants(state);
    opts.onStep?.();
  };
  const pick = <T>(arr: T[]): T => arr[Math.floor(policy.next() * arr.length)] as T;
  const activeIds = () =>
    state.players
      .filter((p) => !p.resigned && !state.eliminatedPlayerIds.includes(p.id))
      .map((p) => p.id);

  if (state.phase === "pre_hand") send(cmd("START_HAND", ids[0] as string, {}, clock));
  let steps = 0;
  const maxSteps = opts.maxSteps ?? 6000;
  while (state.phase !== "match_over" && steps < maxSteps) {
    steps++;
    clock += 300 + Math.floor(policy.next() * 900);
    const w = state.unoWindow;
    if (w && clock - w.openedAt <= state.config.unoWindowMs && policy.next() < 0.35) {
      const others = activeIds().filter((id) => id !== w.playerId);
      send(cmd("CATCH_UNO", pick(others), { targetId: w.playerId }, clock));
      continue;
    }
    // No Mercy: players left on one card by a swap or rotation can be caught too.
    const pending: UnoWindow | undefined = state.unoPending.find(
      (x) =>
        clock - x.openedAt <= state.config.unoWindowMs &&
        state.players.find((p) => p.id === x.playerId)?.hand.length === 1,
    );
    if (pending && policy.next() < 0.35) {
      const others = activeIds().filter((id) => id !== pending.playerId);
      send(cmd("CATCH_UNO", pick(others), { targetId: pending.playerId }, clock));
      continue;
    }
    const actor = (state.players[state.currentSeat] as { id: string }).id;
    const moves = getLegalMoves(state, actor).filter(
      (m) => m.type !== "RESIGN" && m.type !== "REQUEST_SNAPSHOT",
    );
    if (moves.some((m) => m.type === "CALL_UNO") && policy.next() < 0.3) {
      send(cmd("CALL_UNO", actor, {}, clock));
      continue;
    }
    const swaps = moves.filter(
      (m): m is Extract<LegalMove, { type: "CHOOSE_SWAP_TARGET" }> =>
        m.type === "CHOOSE_SWAP_TARGET",
    );
    if (swaps.length > 0) {
      send(cmd("CHOOSE_SWAP_TARGET", actor, { targetId: pick(swaps).targetId }, clock));
      continue;
    }
    const plays = moves.filter(
      (m): m is Extract<LegalMove, { type: "PLAY_CARD" }> => m.type === "PLAY_CARD",
    );
    let chosen: LegalMove | undefined;
    if (moves.some((m) => m.type === "CHALLENGE_WILD_DRAW_FOUR")) {
      const wanted = policy.next() < 0.5 ? "CHALLENGE_WILD_DRAW_FOUR" : "DRAW_CARD";
      chosen = moves.find((m) => m.type === wanted);
    } else if (plays.length > 0 && policy.next() < 0.85) {
      chosen = pick(plays);
    } else {
      chosen =
        moves.find(
          (m) =>
            m.type === "DRAW_CARD" ||
            m.type === "PASS_TURN" ||
            m.type === "CHOOSE_COLOR" ||
            m.type === "START_HAND",
        ) ?? plays[0];
    }
    if (!chosen) throw new Error(`seed ${seed}: no move for ${actor} in ${state.phase}`);
    switch (chosen.type) {
      case "PLAY_CARD": {
        const extra: Record<string, unknown> = {
          cardId: chosen.cardId,
          callUno: policy.next() < 0.5,
        };
        if (chosen.requiresColor) extra.color = pick(chosen.colors) as Color;
        send(cmd("PLAY_CARD", actor, extra, clock));
        break;
      }
      case "CHOOSE_COLOR":
        send(cmd("CHOOSE_COLOR", actor, { color: chosen.color }, clock));
        break;
      default:
        send(cmd(chosen.type, actor, {}, clock));
    }
  }
  return { initial, states, events, commands, final: state, steps };
}
