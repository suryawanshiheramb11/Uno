import { describe, expect, it } from "vitest";
import { filterEventsForViewer } from "./snapshots";
import { getLegalMoves } from "./rules";
import {
  cmd,
  currentId,
  expectConserved,
  expectRejected,
  find,
  handOf,
  junk,
  run,
  setup,
  types,
} from "./test-helpers";

const stuck = (draw: string[], extra: Partial<Parameters<typeof setup>[0]> = {}) =>
  setup({
    variant: "no_mercy",
    hands: {
      a: ["green-1", "green-2"],
      b: ["blue-1", "blue-2", "blue-3"],
      c: ["yellow-1", "yellow-2", "yellow-3"],
    },
    top: "red-5",
    draw,
    ...extra,
  });

describe("Draw Until You Can Play", () => {
  it("cannot draw while holding a playable card", () => {
    const g = setup({
      variant: "no_mercy",
      hands: { a: ["red-1", "green-1"], b: ["blue-1", "blue-2"], c: ["yellow-1", "yellow-2"] },
      top: "red-5",
      draw: ["blue-9"],
    });
    expectRejected(g.state, cmd("DRAW_CARD", "a"), "CANNOT_DRAW_WITH_PLAYABLE");
    expect(getLegalMoves(g.state, "a").some((m) => m.type === "DRAW_CARD")).toBe(false);
  });

  it("draws one card at a time until a playable one appears", () => {
    const g = stuck(["yellow-4", "yellow-6", "blue-9", "red-9", "red-8"]);
    const { state, events } = run(g.state, cmd("DRAW_CARD", "a"));
    expect(types(events)).toEqual(["CARDS_DRAWN", "CARDS_DRAWN", "CARDS_DRAWN", "CARDS_DRAWN"]);
    const drawn = events.flatMap((e) => (e.type === "CARDS_DRAWN" ? [e] : []));
    expect(drawn.map((e) => e.count)).toEqual([1, 1, 1, 1]);
    expect(drawn.map((e) => e.reason)).toEqual(Array(4).fill("draw_until_play"));
    expect(drawn.map((e) => e.cardIds)).toEqual(
      ["yellow-4", "yellow-6", "blue-9", "red-9"].map((s) => [g.id(s)]),
    );
    expect(handOf(state, "a")).toHaveLength(6);
    expect(state.phase).toBe("play_or_draw");
    expect(state.drawnCardId).toBe(g.id("red-9"));
    expect(currentId(state)).toBe("a");
    expectConserved(state);
  });

  it("stops at the first playable card even if more follow", () => {
    const g = stuck(["red-9", "red-8"]);
    const { state, events } = run(g.state, cmd("DRAW_CARD", "a"));
    expect(types(events)).toEqual(["CARDS_DRAWN"]);
    expect(state.drawPile.at(-1)).toBe(g.id("red-8"));
  });

  it("a card matching only the number is playable", () => {
    const g = stuck(["yellow-4", "yellow-5"]);
    expect(run(g.state, cmd("DRAW_CARD", "a")).state.drawnCardId).toBe(g.id("yellow-5"));
  });

  it("a card matching only the symbol is playable", () => {
    const g = setup({
      variant: "no_mercy",
      hands: { a: ["green-1", "green-2"], b: ["blue-1", "blue-2"], c: ["yellow-1", "yellow-2"] },
      top: "red-skip",
      draw: ["yellow-4", "blue-skip"],
    });
    expect(run(g.state, cmd("DRAW_CARD", "a")).state.drawnCardId).toBe(g.id("blue-skip"));
  });

  it("every Wild counts as playable", () => {
    for (const spec of ["wrd4", "wd6", "wd10", "roulette"]) {
      const g = stuck(["yellow-4", spec]);
      expect(run(g.state, cmd("DRAW_CARD", "a")).state.drawnCardId).toBe(g.id(spec));
    }
  });

  it("makes the drawn card the only legal move", () => {
    const g = stuck(["yellow-4", "red-9"]);
    const { state } = run(g.state, cmd("DRAW_CARD", "a"));
    expect(getLegalMoves(state, "a").map((m) => m.type)).toEqual([
      "PLAY_CARD",
      "RESIGN",
      "REQUEST_SNAPSHOT",
    ]);
    expect(getLegalMoves(state, "a")[0]).toMatchObject({
      type: "PLAY_CARD",
      cardId: g.id("red-9"),
    });
  });

  it("cannot be passed", () => {
    const g = stuck(["red-9"]);
    const { state } = run(g.state, cmd("DRAW_CARD", "a"));
    expectRejected(state, cmd("PASS_TURN", "a"), "MUST_PLAY_DRAWN_CARD");
  });

  it("rejects playing any other card", () => {
    const g = stuck(["red-9"]);
    const { state } = run(g.state, cmd("DRAW_CARD", "a"));
    expectRejected(state, cmd("PLAY_CARD", "a", { cardId: g.id("green-1") }), "NOT_DRAWN_CARD");
  });

  it("cannot draw again", () => {
    const g = stuck(["red-9"]);
    const { state } = run(g.state, cmd("DRAW_CARD", "a"));
    expectRejected(state, cmd("DRAW_CARD", "a"), "ALREADY_DREW");
  });

  it("playing the drawn card ends the turn normally", () => {
    const g = stuck(["yellow-4", "red-9"]);
    const drew = run(g.state, cmd("DRAW_CARD", "a")).state;
    const { state, events } = run(drew, cmd("PLAY_CARD", "a", { cardId: g.id("red-9") }));
    expect(types(events)).toEqual(["CARD_PLAYED", "TURN_CHANGED"]);
    expect(currentId(state)).toBe("b");
    expect(state.drawnCardId).toBeNull();
    expect(handOf(state, "a")).toHaveLength(3);
  });

  it("a drawn penalty card starts a stack when played", () => {
    const g = stuck(["yellow-4", "red-draw_four"]);
    const drew = run(g.state, cmd("DRAW_CARD", "a")).state;
    const { state } = run(drew, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_four") }));
    expect(state.pendingPenalty).toEqual({ total: 4, topValue: 4 });
    expect(currentId(state)).toBe("b");
  });

  it("only the current player may draw", () => {
    const g = stuck(["red-9"]);
    expectRejected(g.state, cmd("DRAW_CARD", "b"), "NOT_YOUR_TURN");
  });

  it("clears the called-UNO flag when the hand grows", () => {
    const g = stuck(["red-9"], {
      hands: {
        a: ["green-1"],
        b: ["blue-1", "blue-2", "blue-3"],
        c: ["yellow-1", "yellow-2", "yellow-3"],
      },
      unoCalled: ["a"],
    });
    const { state } = run(g.state, cmd("DRAW_CARD", "a"));
    expect(state.players[0]?.unoCalled).toBe(false);
  });

  it("ends the turn when the draw pile runs out with nothing playable", () => {
    const g = stuck(["yellow-4", "yellow-6"]);
    g.state.drawPile = [g.id("yellow-6"), g.id("yellow-4")].reverse().reverse();
    g.state.discardPile = [g.state.discardPile.at(-1) as string];
    const { state, events } = run(g.state, cmd("DRAW_CARD", "a"));
    expect(types(events)).toEqual(["CARDS_DRAWN", "CARDS_DRAWN", "TURN_CHANGED"]);
    expect(handOf(state, "a")).toHaveLength(4);
    expect(currentId(state)).toBe("b");
  });

  it("reshuffles the discard pile mid-draw and keeps going", () => {
    const g = stuck(["yellow-4"], { fillerTo: "discard" });
    const { state, events } = run(g.state, cmd("DRAW_CARD", "a"));
    expect(types(events)).toContain("DRAW_PILE_RESHUFFLED");
    expect(events.filter((e) => e.type === "CARDS_DRAWN").length).toBeGreaterThanOrEqual(2);
    expectConserved(state);
  });

  it("eliminates the player mid-draw when they hit 25 and ends the loop", () => {
    const pool = junk(26);
    const g = setup({
      variant: "no_mercy",
      hands: {
        a: pool.slice(0, 24),
        b: ["blue-1", "blue-2", "blue-3"],
        c: ["red-1", "red-2", "red-3"],
      },
      top: "red-5",
      draw: pool.slice(24),
    });
    const { state, events } = run(g.state, cmd("DRAW_CARD", "a"));
    expect(types(events)).toEqual(["CARDS_DRAWN", "PLAYER_ELIMINATED", "TURN_CHANGED"]);
    expect(find(events, "PLAYER_ELIMINATED")).toEqual({
      type: "PLAYER_ELIMINATED",
      playerId: "a",
      cardsReturned: 25,
    });
    expect(handOf(state, "a")).toEqual([]);
    expect(state.eliminatedPlayerIds).toEqual(["a"]);
    expect(currentId(state)).toBe("b");
    expect(state.drawPile).toContain(g.id(pool[25] as string));
    expectConserved(state);
  });

  it("hides the drawn cards from other players but not from the drawer", () => {
    const g = stuck(["yellow-4", "red-9"]);
    const { events } = run(g.state, cmd("DRAW_CARD", "a"));
    const seenByB = filterEventsForViewer(events, "b").filter((e) => e.type === "CARDS_DRAWN");
    expect(seenByB.every((e) => !("cardIds" in e))).toBe(true);
    const seenByA = filterEventsForViewer(events, "a").filter((e) => e.type === "CARDS_DRAWN");
    expect(seenByA.every((e) => "cardIds" in e)).toBe(true);
    expect(find(events, "CARDS_DRAWN").playerId).toBe("a");
  });
});
