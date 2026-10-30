import { describe, expect, it } from "vitest";
import {
  NM_DECK_SIZE,
  NO_MERCY_DEFS,
  CLASSIC_DEFS,
  cardDefOf,
  cardIndex,
  cardLabel,
  cardOf,
  cardPoints,
  deckSizeOf,
  drawValue,
  isValidCardId,
  makeCardId,
  variantOfCardId,
} from "./cards";
import { COLORS } from "./types";
import { cmd, expectConserved, find, findSeed, started, types } from "./test-helpers";
import { createInitialState } from "./engine";
import { createRng } from "./rng";
import { EngineError } from "./types";

const count = (pred: (d: (typeof NO_MERCY_DEFS)[number]) => boolean) =>
  NO_MERCY_DEFS.filter(pred).length;

describe("No Mercy deck", () => {
  it("has 168 cards", () => {
    expect(NO_MERCY_DEFS).toHaveLength(168);
    expect(NM_DECK_SIZE).toBe(168);
    expect(deckSizeOf("no_mercy")).toBe(168);
    expect(deckSizeOf("classic")).toBe(108);
  });
  it("has 36 cards in each colour", () => {
    for (const c of COLORS) expect(count((d) => d.color === c)).toBe(36);
  });
  it("has two of every number 0-9 in each colour", () => {
    for (const c of COLORS) {
      for (let n = 0; n <= 9; n++) {
        expect(count((d) => d.color === c && d.face === "number" && d.value === n)).toBe(2);
      }
    }
  });
  it.each([
    ["skip", 3],
    ["reverse", 3],
    ["draw_two", 3],
    ["draw_four", 2],
    ["discard_all", 3],
    ["skip_everyone", 2],
  ])("has %s x%i per colour", (face, copies) => {
    for (const c of COLORS) expect(count((d) => d.color === c && d.face === face)).toBe(copies);
  });
  it.each(["wild_reverse_draw_four", "wild_draw_six", "wild_draw_ten", "wild_color_roulette"])(
    "has six %s",
    (face) => expect(count((d) => d.face === face)).toBe(6),
  );
  it("has no Classic wilds", () => {
    expect(count((d) => d.face === "wild" || d.face === "wild_draw_four")).toBe(0);
  });
  it("keeps the Classic deck untouched", () => expect(CLASSIC_DEFS).toHaveLength(108));
});

describe("No Mercy card ids", () => {
  it("carry a capital N prefix; Classic ids do not", () => {
    expect(makeCardId(7, 0, "no_mercy")).toBe("N7-0");
    expect(makeCardId(7, 0)).toBe("7-0");
    expect(makeCardId(7, 0, "classic")).toBe("7-0");
  });
  it("tell the two variants apart even when the Classic seed starts with n", () => {
    expect(variantOfCardId("n7-0")).toBe("classic");
    expect(variantOfCardId("N7-0")).toBe("no_mercy");
  });
  it("resolve to No Mercy definitions", () => {
    expect(cardOf("N7-0")).toEqual({ id: "N7-0", color: "red", face: "number", value: 0 });
    expect(cardDefOf(makeCardId(7, 167, "no_mercy")).face).toBe("wild_color_roulette");
    expect(cardIndex("N7-167")).toBe(167);
  });
  it("validate the index against the variant's deck size", () => {
    expect(isValidCardId("N7-167")).toBe(true);
    expect(isValidCardId("N7-168")).toBe(false);
    expect(isValidCardId("7-108")).toBe(false);
    expect(isValidCardId("7-107")).toBe(true);
  });
});

describe("No Mercy card values", () => {
  it.each([
    ["red-draw_two", 2],
    ["red-draw_four", 4],
    ["wrd4", 4],
    ["wd6", 6],
    ["wd10", 10],
    ["red-skip", 0],
    ["roulette", 0],
  ])("stack value of %s is %i", (spec, value) => {
    const idx = NO_MERCY_DEFS.findIndex((d) => {
      if (spec === "wrd4") return d.face === "wild_reverse_draw_four";
      if (spec === "wd6") return d.face === "wild_draw_six";
      if (spec === "wd10") return d.face === "wild_draw_ten";
      if (spec === "roulette") return d.face === "wild_color_roulette";
      return d.color === "red" && d.face === spec.slice(4);
    });
    expect(drawValue(NO_MERCY_DEFS[idx]!)).toBe(value);
  });
  it("scores numbers at face value, coloured actions 20 and wilds 50", () => {
    const def = (face: string) => NO_MERCY_DEFS.find((d) => d.face === face)!;
    expect(cardPoints({ color: "red", face: "number", value: 8 })).toBe(8);
    for (const f of ["skip", "reverse", "draw_two", "draw_four", "discard_all", "skip_everyone"]) {
      expect(cardPoints(def(f))).toBe(20);
    }
    for (const f of [
      "wild_reverse_draw_four",
      "wild_draw_six",
      "wild_draw_ten",
      "wild_color_roulette",
    ]) {
      expect(cardPoints(def(f))).toBe(50);
    }
  });
  it("labels the new cards", () => {
    const idx = (face: string) => NO_MERCY_DEFS.findIndex((d) => d.face === face);
    expect(cardLabel(makeCardId(7, idx("discard_all"), "no_mercy"))).toBe("Red Discard All");
    expect(cardLabel(makeCardId(7, idx("wild_draw_ten"), "no_mercy"))).toBe("Wild Draw Ten");
  });
});

describe("creating and dealing a No Mercy game", () => {
  it("builds a No Mercy state with the extra fields empty and mercy defaults", () => {
    const s = createInitialState("no_mercy", ["a", "b"], {}, createRng(1));
    expect(s.variant).toBe("no_mercy");
    expect(s.config.mercyThreshold).toBe(25);
    expect(s.config.sevenZeroRules).toBe(true);
    expect([s.pendingPenalty, s.swapTargetAwaiting, s.colorRouletteActive]).toEqual([
      null,
      null,
      null,
    ]);
    expect([s.eliminatedPlayerIds, s.unoPending]).toEqual([[], []]);
  });
  it("Classic configs do not gain No Mercy settings", () => {
    const s = createInitialState("classic", ["a", "b"], {}, createRng(1));
    expect("mercyThreshold" in s.config).toBe(false);
  });
  it("rejects a mercy threshold that is not above the starting hand", () => {
    try {
      createInitialState("no_mercy", ["a", "b"], { mercyThreshold: 7 }, createRng(1));
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("INVALID_CONFIG");
    }
  });
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10])(
    "deals seven cards to each of %i players from 168 cards",
    (n) => {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const { state, events } = started(3, ids, {}, "no_mercy");
      expect(state.players.every((p) => p.hand.length === 7)).toBe(true);
      expect(state.drawPile.length + state.discardPile.length).toBe(168 - 7 * n);
      expect(state.drawPile.every((id) => id.startsWith("N"))).toBe(true);
      expectConserved(state);
      expect(find(events, "HAND_STARTED").handNumber).toBe(1);
    },
  );
  it("the opening card is always a number, over many seeds", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { state } = started(seed, ["a", "b", "c"], {}, "no_mercy");
      expect(cardDefOf(state.discardPile[0] as string).face).toBe("number");
      expect(state.phase).toBe("awaiting_play_or_draw");
      expect(state.currentSeat).toBe(0);
    }
  });
  it("an action card turned up first goes to the bottom of the pile", () => {
    const seed = findSeed(
      (_, e) => e.some((x) => x.type === "OPENING_CARD_RESHUFFLED"),
      ["a", "b", "c"],
      "no_mercy",
    );
    const { state, events } = started(seed, ["a", "b", "c"], {}, "no_mercy");
    const skipped = events.flatMap((e) => (e.type === "OPENING_CARD_RESHUFFLED" ? [e.cardId] : []));
    expect(skipped.length).toBeGreaterThan(0);
    for (const id of skipped) expect(state.drawPile).toContain(id);
    expect(state.drawPile[0]).toBe(skipped[skipped.length - 1]);
    expect(types(events)).not.toContain("PLAYER_SKIPPED");
    expectConserved(state);
  });
  it("a new hand clears every No Mercy field", () => {
    const { state } = started(5, ["a", "b", "c"], {}, "no_mercy");
    expect(state.pendingPenalty).toBeNull();
    expect(state.eliminatedPlayerIds).toEqual([]);
    expect(state.unoPending).toEqual([]);
    expect(find(started(5, ["a", "b", "c"], {}, "no_mercy").events, "TURN_CHANGED").playerId).toBe(
      "a",
    );
    expect(cmd).toBeDefined();
  });
});
