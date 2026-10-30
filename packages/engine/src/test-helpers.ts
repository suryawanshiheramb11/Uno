import { expect } from "vitest";
import { CLASSIC_DEFS, DECK_SIZE, cardDefOf, makeCardId } from "./cards";
import { applyCommand, createInitialState } from "./engine";
import { createRng } from "./rng";
import { COLORS } from "./types";
import type {
  CardDef,
  ClassicConfig,
  Color,
  Command,
  EngineEvent,
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
  const [color, rest] = base.split(/-(.+)/) as [string, string];
  if (/^\d$/.test(rest))
    return (d) => d.color === color && d.face === "number" && d.value === Number(rest);
  return (d) => d.color === color && d.face === rest;
}

export interface SetupOpts {
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
  config?: Partial<ClassicConfig>;
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
  const state = createInitialState("classic", players, o.config ?? {}, createRng(1));
  const used = new Set<number>();
  const ids = new Map<string, string>();
  const placed = new Set<string>();
  const alloc = (spec: string): string => {
    const known = ids.get(spec);
    if (known) return known;
    const m = matcher(spec);
    const idx = CLASSIC_DEFS.findIndex((d, i) => !used.has(i) && m(d));
    if (idx < 0) throw new Error(`setup: no card left for "${spec}"`);
    used.add(idx);
    const id = makeCardId(SEED, idx);
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
  for (let i = 0; i < DECK_SIZE; i++) if (!used.has(i)) filler.push(makeCardId(SEED, i));
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
  config: Partial<ClassicConfig> = {},
) {
  const s0 = createInitialState("classic", playerIds, config, createRng(seed));
  const res = applyCommand(s0, cmd("START_HAND", playerIds[0] as string, {}, 0));
  return { initial: s0, ...res };
}

export function findSeed(
  pred: (s: GameState, events: EngineEvent[]) => boolean,
  playerIds = ["a", "b", "c"],
): number {
  for (let seed = 1; seed < 20000; seed++) {
    const r = started(seed, playerIds);
    if (pred(r.state, r.events)) return seed;
  }
  throw new Error("findSeed: no seed matched");
}

export function allCardIds(s: GameState): string[] {
  return [...s.drawPile, ...s.discardPile, ...s.players.flatMap((p) => p.hand)];
}

export function expectConserved(s: GameState): void {
  const all = allCardIds(s);
  expect(all).toHaveLength(DECK_SIZE);
  expect(new Set(all).size).toBe(DECK_SIZE);
}

export { COLORS };
