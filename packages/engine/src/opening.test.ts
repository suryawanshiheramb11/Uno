import { describe, expect, it } from "vitest";
import { cardDefOf } from "./cards";
import { applyCommand as run } from "./engine";
import { getLegalMoves } from "./rules";
import { COLORS } from "./types";
import type { GameState } from "./types";
import {
  cmd,
  currentId,
  expectConserved,
  expectRejected,
  find,
  findSeed,
  started,
  types,
} from "./test-helpers";

const opener = (s: { discardPile: string[] }) => cardDefOf(s.discardPile[0] as string);
const choose = (state: GameState, color: string) => run(state, cmd("CHOOSE_COLOR", "a", { color }));
const seedFor = (face: string, players = ["a", "b", "c"]) =>
  findSeed((s) => opener(s).face === face, players);

describe("opening card: number", () => {
  it("first player plays; colour comes from the card", () => {
    const { state, events } = started(seedFor("number"));
    expect(state.phase).toBe("awaiting_play_or_draw");
    expect(state.currentSeat).toBe(0);
    expect(state.direction).toBe(1);
    expect(state.activeColor).toBe(opener(state).color);
    expect(types(events)).not.toContain("PLAYER_SKIPPED");
    expect(find(events, "TURN_CHANGED").playerId).toBe("a");
  });
});

describe("opening card: Skip", () => {
  it("skips the first player", () => {
    const { state, events } = started(seedFor("skip"));
    expect(currentId(state)).toBe("b");
    expect(find(events, "PLAYER_SKIPPED")).toEqual({
      type: "PLAYER_SKIPPED",
      playerId: "a",
      reason: "opening_card",
    });
    expect(find(events, "TURN_CHANGED").playerId).toBe("b");
    expect(state.players[0]?.hand).toHaveLength(7);
  });
  it("in a two-player game the second player starts", () => {
    const { state } = started(seedFor("skip", ["a", "b"]), ["a", "b"]);
    expect(currentId(state)).toBe("b");
  });
});

describe("opening card: Draw Two", () => {
  it("first player draws two and is skipped", () => {
    const { state, events } = started(seedFor("draw_two"));
    expect(state.players[0]?.hand).toHaveLength(9);
    expect(currentId(state)).toBe("b");
    expect(find(events, "CARDS_DRAWN")).toMatchObject({
      playerId: "a",
      count: 2,
      reason: "opening_card",
    });
    expect(find(events, "PLAYER_SKIPPED").reason).toBe("opening_card");
    expectConserved(state);
  });
  it("applies in a two-player game too", () => {
    const { state } = started(seedFor("draw_two", ["a", "b"]), ["a", "b"]);
    expect(state.players[0]?.hand).toHaveLength(9);
    expect(currentId(state)).toBe("b");
  });
});

describe("opening card: Reverse", () => {
  it("reverses direction and the dealer plays first", () => {
    const { state, events } = started(seedFor("reverse"));
    expect(state.direction).toBe(-1);
    expect(currentId(state)).toBe("c");
    expect(find(events, "DIRECTION_REVERSED").direction).toBe(-1);
    expect(find(events, "TURN_CHANGED")).toEqual({
      type: "TURN_CHANGED",
      playerId: "c",
      direction: -1,
    });
  });
  it("in a two-player game the dealer plays first (Reverse acts as Skip)", () => {
    const { state } = started(seedFor("reverse", ["a", "b"]), ["a", "b"]);
    expect(currentId(state)).toBe("b");
    expect(state.direction).toBe(-1);
  });
  it("with four players the dealer (last seat) plays first", () => {
    const four = ["a", "b", "c", "d"];
    const { state } = started(seedFor("reverse", four), four);
    expect(currentId(state)).toBe("d");
  });
});

describe("opening card: Wild", () => {
  const seed = seedFor("wild");
  it("the first player must choose the colour", () => {
    const { state, events } = started(seed);
    expect(state.phase).toBe("awaiting_opening_color");
    expect(state.activeColor).toBeNull();
    expect(currentId(state)).toBe("a");
    expect(getLegalMoves(state, "a").filter((m) => m.type === "CHOOSE_COLOR")).toHaveLength(4);
    expect(find(events, "OPENING_CARD").cardId).toBe(state.discardPile[0]);
  });
  it.each(COLORS)("CHOOSE_COLOR %s sets the colour and starts play", (color) => {
    const { state } = started(seed);
    const res = choose(state, color);
    expect(res.state.activeColor).toBe(color);
    expect(res.state.phase).toBe("awaiting_play_or_draw");
    expect(currentId(res.state)).toBe("a");
    expect(res.events).toEqual([{ type: "COLOR_CHOSEN", playerId: "a", color }]);
  });
  it("cannot play before choosing", () => {
    const { state } = started(seed);
    const id = state.players[0]?.hand[0] as string;
    expectRejected(
      state,
      cmd("PLAY_CARD", "a", { cardId: id, color: "red" }),
      "COLOR_CHOICE_PENDING",
    );
  });
  it("cannot draw or pass before choosing", () => {
    const { state } = started(seed);
    expectRejected(state, cmd("DRAW_CARD", "a"), "COLOR_CHOICE_PENDING");
    expectRejected(state, cmd("PASS_TURN", "a"), "COLOR_CHOICE_PENDING");
  });
  it("only the first player may choose", () => {
    const { state } = started(seed);
    expectRejected(state, cmd("CHOOSE_COLOR", "b", { color: "red" }), "NOT_YOUR_TURN");
  });
  it("rejects an invalid colour", () => {
    const { state } = started(seed);
    expectRejected(state, cmd("CHOOSE_COLOR", "a", { color: "pink" }), "COLOR_INVALID");
  });
  it("CHOOSE_COLOR is rejected once play has started", () => {
    const { state } = started(seed);
    const played = choose(state, "red").state;
    expectRejected(played, cmd("CHOOSE_COLOR", "a", { color: "blue" }), "WRONG_PHASE");
  });
});

describe("opening card: Wild Draw Four", () => {
  const seed = findSeed((_, e) => e.some((x) => x.type === "OPENING_CARD_RESHUFFLED"));
  it("is shuffled back and replaced", () => {
    const { state, events } = started(seed);
    const buried = find(events, "OPENING_CARD_RESHUFFLED").cardId;
    expect(cardDefOf(buried).face).toBe("wild_draw_four");
    expect(cardDefOf(state.discardPile[0] as string).face).not.toBe("wild_draw_four");
    expect(state.drawPile).toContain(buried);
    expect(events.map((e) => e.type).indexOf("OPENING_CARD_RESHUFFLED")).toBeLessThan(
      types(events).indexOf("OPENING_CARD"),
    );
    expectConserved(state);
  });
  it("never remains the opening card over many seeds", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const { state } = started(seed);
      expect(cardDefOf(state.discardPile[0] as string).face).not.toBe("wild_draw_four");
    }
  });
});
