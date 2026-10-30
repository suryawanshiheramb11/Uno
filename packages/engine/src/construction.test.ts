import { describe, expect, it } from "vitest";
import { CLASSIC_DEFS, cardLabel, cardOf, cardPoints, makeCardId } from "./cards";
import { applyCommand, createInitialState } from "./engine";
import { createRng } from "./rng";
import { COLORS, DEFAULT_CLASSIC_CONFIG, EngineError } from "./types";
import {
  cmd,
  expectConserved,
  expectRejected,
  find,
  findSeed,
  started,
  types,
} from "./test-helpers";

const create = (ids: string[], cfg = {}, seed = 1) =>
  createInitialState("classic", ids, cfg, createRng(seed));

describe("state construction", () => {
  it("creates a pre_hand state with zeroed players", () => {
    const s = create(["a", "b", "c"]);
    expect(s.phase).toBe("pre_hand");
    expect(s.handNumber).toBe(0);
    expect(s.version).toBe(0);
    expect(s.players.map((p) => [p.id, p.hand.length, p.score, p.resigned])).toEqual([
      ["a", 0, 0, false],
      ["b", 0, 0, false],
      ["c", 0, 0, false],
    ]);
    expect(s.drawPile).toEqual([]);
  });

  it("rejects fewer than two players", () => {
    expect(() => create(["a"])).toThrow(EngineError);
    try {
      create(["a"]);
    } catch (e) {
      expect((e as EngineError).code).toBe("INVALID_PLAYERS");
    }
  });
  it("rejects more than ten players", () =>
    expect(() => create(Array.from({ length: 11 }, (_, i) => `p${i}`))).toThrow(/2-10/));
  it("rejects duplicate player ids", () => expect(() => create(["a", "a"])).toThrow(EngineError));
  it("rejects empty player ids", () => expect(() => create(["a", ""])).toThrow(EngineError));
  it("rejects an unknown variant with UNSUPPORTED_VARIANT", () => {
    try {
      createInitialState("chess" as never, ["a", "b"], {}, createRng(1));
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("UNSUPPORTED_VARIANT");
    }
  });
  it("merges config over defaults", () => {
    const s = create(["a", "b"], { unoWindowMs: 1500, targetScore: 500 });
    expect(s.config).toEqual({ ...DEFAULT_CLASSIC_CONFIG, unoWindowMs: 1500, targetScore: 500 });
  });
  it("defaults match the rulebook (3s window, +2 penalty, 7 cards)", () => {
    expect(create(["a", "b"]).config).toEqual({
      initialHandSize: 7,
      unoWindowMs: 3000,
      unoPenalty: 2,
      strictWildDrawFour: false,
      targetScore: null,
    });
  });
  it("rejects out-of-range config", () => {
    expect(() => create(["a", "b"], { initialHandSize: 0 })).toThrow(/Config/);
    expect(() => create(["a", "b"], { initialHandSize: 50 })).toThrow(/Config/);
  });
  it("seeds rngState from the injected rng, not from a global", () => {
    expect(create(["a", "b"], {}, 1).rngState).not.toEqual(create(["a", "b"], {}, 2).rngState);
    expect(create(["a", "b"], {}, 5).rngState).toEqual(create(["a", "b"], {}, 5).rngState);
  });
});

describe("deck", () => {
  it("has 108 card definitions", () => expect(CLASSIC_DEFS).toHaveLength(108));
  it("has one 0 and two of each 1-9 per colour", () => {
    for (const color of COLORS) {
      const nums = CLASSIC_DEFS.filter((d) => d.color === color && d.face === "number");
      expect(nums.filter((d) => d.value === 0)).toHaveLength(1);
      for (let n = 1; n <= 9; n++) expect(nums.filter((d) => d.value === n)).toHaveLength(2);
    }
  });
  it("has two Skip, Reverse and Draw Two per colour", () => {
    for (const color of COLORS) {
      for (const face of ["skip", "reverse", "draw_two"]) {
        expect(CLASSIC_DEFS.filter((d) => d.color === color && d.face === face)).toHaveLength(2);
      }
    }
  });
  it("has four Wild and four Wild Draw Four", () => {
    expect(CLASSIC_DEFS.filter((d) => d.face === "wild")).toHaveLength(4);
    expect(CLASSIC_DEFS.filter((d) => d.face === "wild_draw_four")).toHaveLength(4);
  });
  it("card ids derive from the hand seed and deck index", () => {
    expect(makeCardId(7, 0)).toBe("7-0");
    expect(makeCardId(255, 107)).toBe("73-107");
    expect(cardOf("7-0")).toEqual({ id: "7-0", color: "red", face: "number", value: 0 });
  });
  it("scores cards per the rulebook", () => {
    expect(cardPoints({ color: "red", face: "number", value: 7 })).toBe(7);
    expect(cardPoints({ color: "red", face: "number", value: 0 })).toBe(0);
    expect(cardPoints({ color: "red", face: "skip", value: null })).toBe(20);
    expect(cardPoints({ color: "red", face: "reverse", value: null })).toBe(20);
    expect(cardPoints({ color: "red", face: "draw_two", value: null })).toBe(20);
    expect(cardPoints({ color: null, face: "wild", value: null })).toBe(50);
    expect(cardPoints({ color: null, face: "wild_draw_four", value: null })).toBe(50);
  });
  it("labels cards for humans", () => {
    expect(cardLabel("7-0")).toBe("Red 0");
    expect(cardLabel(makeCardId(7, 100))).toBe("Wild");
    expect(cardLabel(makeCardId(7, 104))).toBe("Wild Draw Four");
  });
});

describe("START_HAND", () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10])("deals seven cards to each of %i players", (n) => {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const { state, events } = started(3, ids);
    expect(state.players.every((p) => p.hand.length === 7)).toBe(true);
    expect(state.drawPile.length + state.discardPile.length).toBe(108 - 7 * n);
    expect(state.phase).not.toBe("pre_hand");
    expectConserved(state);
    expect(find(events, "HAND_STARTED").handNumber).toBe(1);
  });

  it("emits HAND_STARTED, OPENING_CARD, then TURN_CHANGED", () => {
    const { events } = started(3);
    const t = types(events);
    expect(t[0]).toBe("HAND_STARTED");
    expect(t).toContain("OPENING_CARD");
    expect(t[t.length - 1]).toBe("TURN_CHANGED");
  });

  it("makes the player left of the dealer first when the opener is a number card", () => {
    const seed = findSeed(
      (s) =>
        s.phase === "awaiting_play_or_draw" &&
        s.discardPile.length === 1 &&
        s.currentSeat === 0 &&
        s.direction === 1,
    );
    const { state, events } = started(seed);
    expect(state.dealerSeat).toBe(2);
    expect(find(events, "HAND_STARTED")).toMatchObject({ dealerId: "c", firstPlayerId: "a" });
    expect(state.currentSeat).toBe(0);
  });

  it("deals round-robin from the first player (all cards unique and conserved)", () => {
    const { state } = started(11);
    const all = state.players.flatMap((p) => p.hand);
    expect(new Set(all).size).toBe(21);
    expectConserved(state);
  });

  it("bumps version only when a command is accepted", () => {
    const r = started(3);
    expect(r.initial.version).toBe(0);
    expect(r.state.version).toBe(1);
    expect(r.state.seenCommandIds).toHaveLength(1);
  });

  it("different seeds deal different hands", () => {
    expect(started(1).state.players[0]?.hand).not.toEqual(started(2).state.players[0]?.hand);
  });

  it("starting twice is rejected with HAND_IN_PROGRESS", () => {
    const { state } = started(3);
    expectRejected(state, cmd("START_HAND", "b"), "HAND_IN_PROGRESS");
  });

  it("every card id of a hand carries that hand's seed", () => {
    const { state } = started(3);
    const prefix = `${state.handSeed.toString(36)}-`;
    expect(state.drawPile.every((id) => id.startsWith(prefix))).toBe(true);
    expect(state.players[0]?.hand.every((id) => id.startsWith(prefix))).toBe(true);
  });

  it("rejects START_HAND from a stranger", () => {
    const s = create(["a", "b"]);
    expectRejected(s, cmd("START_HAND", "zed"), "UNKNOWN_PLAYER");
  });

  it("returns the same result for the same input (pure)", () => {
    const s = create(["a", "b", "c"], {}, 9);
    const c = cmd("START_HAND", "a");
    expect(JSON.stringify(applyCommand(s, c))).toBe(JSON.stringify(applyCommand(s, c)));
  });
});
