import { expect } from "vitest";
import type { Variant } from "@uno/shared";
import { cardDefOf, deckSizeOf, defsFor, makeCardId } from "./cards";
import { createInitialState } from "./state";
import { applyCommand } from "./commands";
import { createRng } from "./rng";
import { COLORS } from "./types";
import type {
  CardDef,
  Color,
  Command,
  EngineEvent,
  GameConfig,
  GameState,
  Phase,
  RejectReason,
} from "./types";

export const SEED = 7;

/** "red-5", "blue-skip", "green-draw_two", "yellow-reverse", "wild", "wd4"; add "#2" for a second copy. */
function matcher(spec: string): (d: CardDef) => boolean {
  const base = spec.split("#")[0] as string;
  if (base === "wild") return (d) => d.face === "wild";
  if (base === "wd4") return (d) => d.face === "wild_draw_four";
  if (base === "wrd4") return (d) => d.face === "wild_reverse_draw_four";
  if (base === "wd6") return (d) => d.face === "wild_draw_six";
  if (base === "wd10") return (d) => d.face === "wild_draw_ten";
  if (base === "roulette") return (d) => d.face === "wild_color_roulette";
  const [color, rest] = base.split(/-(.+)/) as [string, string];
  if (/^\d$/.test(rest))
    return (d) => d.color === color && d.face === "number" && d.value === Number(rest);
  return (d) => d.color === color && d.face === rest;
}

export interface SetupOpts {
  variant?: Variant;
  hands: Record<string, string[]>;
  top: string;
  color?: Color;
  draw?: string[];
  current?: string;
  direction?: 1 | -1;
  phase?: Phase;
  drawn?: string;
  pending?: { playedBy: string; target: string; prev: Color; matching: boolean };
  unoWindow?: { playerId: string; openedAt: number };
  unoCalled?: string[];
  config?: Partial<GameConfig>;
  // ---- No Mercy ----
  /** A stacked penalty the current player is facing. */
  penalty?: { total: number; topValue: number };
  eliminated?: string[];
  /** The current player has just played a 7 and must choose a swap target. */
  swapAwaiting?: boolean;
  /** A Color Roulette is waiting for its target (the current player) to name a colour. */
  roulette?: { playedBy: string };
  /** Where cards not mentioned go: the draw pile (default) or under the top of the discard pile. */
  fillerTo?: "draw" | "discard";
  scores?: Record<string, number>;
}

export interface Setup {
  state: GameState;
  id(spec: string): string;
}

/** Builds an exact mid-hand situation with all 108 cards accounted for. */
export function setup(o: SetupOpts): Setup {
  const players = Object.keys(o.hands);
  const variant = o.variant ?? "classic";
  const defs = defsFor(variant);
  const state = createInitialState(variant, players, o.config ?? {}, createRng(1));
  const used = new Set<number>();
  const ids = new Map<string, string>();
  const placed = new Set<string>();
  const alloc = (spec: string): string => {
    const known = ids.get(spec);
    if (known) return known;
    const m = matcher(spec);
    const idx = defs.findIndex((d, i) => !used.has(i) && m(d));
    if (idx < 0) throw new Error(`setup: no card left for "${spec}"`);
    used.add(idx);
    const id = makeCardId(SEED, idx, variant);
    ids.set(spec, id);
    return id;
  };
  const place = (spec: string): string => {
    if (placed.has(spec)) throw new Error(`setup: "${spec}" used twice`);
    placed.add(spec);
    return alloc(spec);
  };

  state.players.forEach((p) => {
    p.hand = (o.hands[p.id] ?? []).map(place);
    p.score = o.scores?.[p.id] ?? 0;
    p.unoCalled = o.unoCalled?.includes(p.id) ?? false;
  });
  const top = place(o.top);
  const draw = (o.draw ?? []).map(place);
  if (o.drawn) alloc(o.drawn);
  const filler: string[] = [];
  for (let i = 0; i < deckSizeOf(variant); i++) {
    if (!used.has(i)) filler.push(makeCardId(SEED, i, variant));
  }
  if (o.fillerTo === "discard") {
    state.discardPile = [...filler, top];
    state.drawPile = [...draw].reverse();
  } else {
    state.discardPile = [top];
    state.drawPile = [...filler, ...[...draw].reverse()];
  }
  state.handNumber = 1;
  state.handSeed = SEED;
  state.phase = o.phase ?? "awaiting_play_or_draw";
  state.currentSeat = players.indexOf(o.current ?? (players[0] as string));
  state.direction = o.direction ?? 1;
  const topColor = cardDefOf(top).color;
  state.activeColor = o.color ?? topColor;
  if (state.activeColor === null) throw new Error("setup: a wild top card needs an explicit color");
  if (o.drawn) {
    state.drawnCardId = ids.get(o.drawn) as string;
    state.phase = "play_or_draw";
  }
  if (o.pending) {
    state.pendingChallenge = {
      playedById: o.pending.playedBy,
      targetId: o.pending.target,
      previousColor: o.pending.prev,
      hadMatchingColor: o.pending.matching,
    };
    state.phase = "awaiting_challenge";
    state.currentSeat = players.indexOf(o.pending.target);
  }
  if (o.unoWindow) state.unoWindow = o.unoWindow;
  state.eliminatedPlayerIds = o.eliminated ?? [];
  if (o.penalty) {
    state.pendingPenalty = { ...o.penalty };
    state.phase = "facing_penalty";
  }
  if (o.swapAwaiting) {
    state.swapTargetAwaiting = { playerId: players[state.currentSeat] as string };
    state.phase = "awaiting_swap_target";
  }
  if (o.roulette) {
    state.colorRouletteActive = {
      playedById: o.roulette.playedBy,
      targetId: players[state.currentSeat] as string,
    };
    state.phase = "awaiting_roulette_color";
  }
  return { state, id: (spec) => ids.get(spec) ?? alloc(spec) };
}

let counter = 0;
export function cmd(
  type: Command["type"],
  playerId: string,
  extra: Record<string, unknown> = {},
  at = 1000,
): Command {
  return { commandId: `c${++counter}`, type, playerId, at, ...extra } as Command;
}

export const run = applyCommand;

export function types(events: EngineEvent[]): string[] {
  return events.map((e) => e.type);
}

export function find<T extends EngineEvent["type"]>(
  events: EngineEvent[],
  type: T,
): Extract<EngineEvent, { type: T }> {
  const e = events.find((x) => x.type === type);
  if (!e) throw new Error(`event ${type} not emitted: ${types(events).join(",")}`);
  return e as Extract<EngineEvent, { type: T }>;
}

export function handOf(s: GameState, id: string): string[] {
  return (s.players.find((p) => p.id === id) as { hand: string[] }).hand;
}

export function currentId(s: GameState): string {
  return (s.players[s.currentSeat] as { id: string }).id;
}

/** Asserts: state returned unchanged (same reference) and exactly one typed COMMAND_REJECTED event. */
export function expectRejected(state: GameState, command: Command, reason: RejectReason): void {
  const before = JSON.stringify(state);
  const res = applyCommand(state, command);
  expect(res.state).toBe(state);
  expect(JSON.stringify(res.state)).toBe(before);
  expect(res.events).toEqual([
    {
      type: "COMMAND_REJECTED",
      commandId: command.commandId,
      playerId: command.playerId,
      commandType: command.type,
      reason,
    },
  ]);
}

/** Starts a hand from a seeded rng (the public API path). */
export function started(
  seed: number,
  playerIds = ["a", "b", "c"],
  config: Partial<GameConfig> = {},
  variant: Variant = "classic",
) {
  const s0 = createInitialState(variant, playerIds, config, createRng(seed));
  const res = applyCommand(s0, cmd("START_HAND", playerIds[0] as string, {}, 0));
  return { initial: s0, ...res };
}

export function findSeed(
  pred: (s: GameState, events: EngineEvent[]) => boolean,
  playerIds = ["a", "b", "c"],
  variant: Variant = "classic",
): number {
  for (let seed = 1; seed < 20000; seed++) {
    const r = started(seed, playerIds, {}, variant);
    if (pred(r.state, r.events)) return seed;
  }
  throw new Error("findSeed: no seed matched");
}

export function allCardIds(s: GameState): string[] {
  return [...s.drawPile, ...s.discardPile, ...s.players.flatMap((p) => p.hand)];
}

export function expectConserved(s: GameState): void {
  const all = allCardIds(s);
  const size = deckSizeOf(s.variant);
  expect(all).toHaveLength(size);
  expect(new Set(all).size).toBe(size);
}

export { COLORS };

/**
 * `n` distinct No Mercy number cards that match neither colour red nor number 5, so they are never
 * playable on a red 5 (use them to pad a hand towards the mercy limit).
 */
export function junk(n: number): string[] {
  const out: string[] = [];
  for (const color of ["yellow", "green", "blue"]) {
    for (let v = 0; v <= 9; v++) {
      if (v === 5) continue;
      out.push(`${color}-${v}`, `${color}-${v}#2`);
    }
  }
  return out.slice(0, n);
}
