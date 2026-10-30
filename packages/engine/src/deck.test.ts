import { describe, expect, it } from "vitest";
import { createRng } from "./rng";
import { createClassicDeck, createNoMercyDeck, deal, shuffle } from "./deck";

const rngFn = (seed: number) => {
  const r = createRng(seed);
  return () => r.next();
};

describe("createClassicDeck", () => {
  const deck = createClassicDeck(7);
  it("has exactly 108 cards", () => expect(deck).toHaveLength(108));
  it("has unique ids derived from seed + index", () => {
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
    expect(deck[0]?.id).toBe("7-0");
    expect(deck[107]?.id).toBe("7-107");
  });
  it("different seeds give disjoint id sets", () => {
    const other = new Set(createClassicDeck(8).map((c) => c.id));
    expect(deck.some((c) => other.has(c.id))).toBe(false);
  });
  it("has correct per-colour counts", () => {
    for (const color of ["red", "yellow", "green", "blue"]) {
      const cs = deck.filter((c) => c.color === color);
      expect(cs).toHaveLength(25);
      expect(cs.filter((c) => c.face === "number" && c.value === 0)).toHaveLength(1);
      for (let n = 1; n <= 9; n++) {
        expect(cs.filter((c) => c.face === "number" && c.value === n)).toHaveLength(2);
      }
      for (const f of ["skip", "reverse", "draw_two"]) {
        expect(cs.filter((c) => c.face === f)).toHaveLength(2);
      }
    }
  });
  it("has 4 Wild and 4 Wild Draw Four", () => {
    expect(deck.filter((c) => c.face === "wild")).toHaveLength(4);
    expect(deck.filter((c) => c.face === "wild_draw_four")).toHaveLength(4);
  });
  it("wilds are colourless", () => {
    expect(deck.filter((c) => c.color === null)).toHaveLength(8);
  });
  it("No Mercy deck has 168 unique cards", () => {
    const nm = createNoMercyDeck(3);
    expect(nm).toHaveLength(168);
    expect(new Set(nm.map((c) => c.id)).size).toBe(168);
  });
});

describe("shuffle", () => {
  const deck = createClassicDeck(1);
  it("is deterministic for a given seed", () => {
    expect(shuffle(deck, rngFn(5)).map((c) => c.id)).toEqual(
      shuffle(deck, rngFn(5)).map((c) => c.id),
    );
  });
  it("differs across seeds", () => {
    expect(shuffle(deck, rngFn(5)).map((c) => c.id)).not.toEqual(
      shuffle(deck, rngFn(6)).map((c) => c.id),
    );
  });
  it("is a permutation and does not mutate the input", () => {
    const before = deck.map((c) => c.id);
    const out = shuffle(deck, rngFn(9));
    expect(out.map((c) => c.id).sort()).toEqual([...before].sort());
    expect(deck.map((c) => c.id)).toEqual(before);
  });
  it("uses the injected rng (constant 0 reverses-rotates predictably)", () => {
    expect(shuffle([1, 2, 3, 4], () => 0)).toEqual([2, 3, 4, 1]);
  });
  it("tolerates an rng that returns values arbitrarily close to 1", () => {
    expect(shuffle([1, 2, 3], () => 0.999999999)).toHaveLength(3);
  });
});

describe("deal", () => {
  const ids = Array.from({ length: 108 }, (_, i) => i);
  it("deals round-robin hands and leaves the rest as the draw pile", () => {
    const { hands, drawPile } = deal(ids, 3, 7);
    expect(hands).toHaveLength(3);
    expect(hands.every((h) => h.length === 7)).toBe(true);
    expect(hands[0]?.slice(0, 2)).toEqual([0, 3]);
    expect(drawPile).toHaveLength(108 - 21);
    expect(drawPile[0]).toBe(21);
  });
  it("never duplicates or loses cards", () => {
    const { hands, drawPile } = deal(ids, 4, 7);
    expect([...hands.flat(), ...drawPile].sort((a, b) => a - b)).toEqual(ids);
  });
  it("rejects invalid arguments", () => {
    expect(() => deal(ids, 0, 7)).toThrow(RangeError);
    expect(() => deal(ids, 20, 7)).toThrow(RangeError);
  });
});
