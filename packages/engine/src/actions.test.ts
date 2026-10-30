import { describe, expect, it } from "vitest";
import {
  cmd,
  currentId,
  expectConserved,
  expectRejected,
  find,
  handOf,
  run,
  setup,
  types,
} from "./test-helpers";

const three = (a: string[], extra: Partial<Parameters<typeof setup>[0]> = {}) =>
  setup({
    hands: { a, b: ["blue-1", "blue-2", "blue-3"], c: ["green-1", "green-2", "green-3"] },
    top: "red-5",
    draw: ["yellow-1", "yellow-2", "yellow-3", "yellow-4"],
    ...extra,
  });

describe("Skip", () => {
  it("skips the next player", () => {
    const g = three(["red-skip", "red-1", "red-2"]);
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-skip") }));
    expect(currentId(state)).toBe("c");
    expect(types(events)).toEqual(["CARD_PLAYED", "PLAYER_SKIPPED", "TURN_CHANGED"]);
    expect(find(events, "PLAYER_SKIPPED")).toEqual({
      type: "PLAYER_SKIPPED",
      playerId: "b",
      reason: "skip",
    });
    expect(handOf(state, "b")).toHaveLength(3);
  });
  it("wraps past the end of the table", () => {
    const g = setup({
      hands: {
        a: ["blue-1", "blue-2", "blue-3"],
        b: ["blue-4", "blue-6", "blue-7"],
        c: ["red-skip", "red-1", "red-2"],
      },
      top: "red-5",
      current: "c",
    });
    const { state, events } = run(g.state, cmd("PLAY_CARD", "c", { cardId: g.id("red-skip") }));
    expect(currentId(state)).toBe("b");
    expect(find(events, "PLAYER_SKIPPED").playerId).toBe("a");
  });
  it("skips in the reversed direction", () => {
    const g = three(["red-skip", "red-1", "red-2"], { direction: -1 });
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-skip") }));
    expect(currentId(state)).toBe("b");
    expect(find(events, "PLAYER_SKIPPED").playerId).toBe("c");
  });
  it("skips exactly one player at a four-player table", () => {
    const g = setup({
      hands: {
        a: ["red-skip", "red-1", "red-2"],
        b: ["blue-1", "blue-2"],
        c: ["blue-3", "blue-4"],
        d: ["blue-6", "blue-7"],
      },
      top: "red-5",
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-skip") }));
    expect(currentId(state)).toBe("c");
  });
  it("a Skip may be played on another Skip of a different colour", () => {
    const g = setup({
      hands: {
        a: ["blue-skip", "blue-1", "blue-2"],
        b: ["blue-3", "blue-4"],
        c: ["blue-6", "blue-7"],
      },
      top: "red-skip",
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("blue-skip") }));
    expect(state.activeColor).toBe("blue");
    expect(currentId(state)).toBe("c");
  });
  it("does not make the skipped player draw", () => {
    const g = three(["red-skip", "red-1", "red-2"]);
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-skip") }));
    expect(types(events)).not.toContain("CARDS_DRAWN");
    expectConserved(state);
  });
});

describe("Reverse", () => {
  it("flips the direction and passes the turn backwards", () => {
    const g = three(["red-reverse", "red-1", "red-2"]);
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-reverse") }));
    expect(state.direction).toBe(-1);
    expect(currentId(state)).toBe("c");
    expect(types(events)).toEqual(["CARD_PLAYED", "DIRECTION_REVERSED", "TURN_CHANGED"]);
    expect(find(events, "DIRECTION_REVERSED").direction).toBe(-1);
  });
  it("flips back from counter-clockwise", () => {
    const g = three(["red-reverse", "red-1", "red-2"], { direction: -1 });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-reverse") }));
    expect(state.direction).toBe(1);
    expect(currentId(state)).toBe("b");
  });
  it("does not skip anyone with three players", () => {
    const g = three(["red-reverse", "red-1", "red-2"]);
    const { events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-reverse") }));
    expect(types(events)).not.toContain("PLAYER_SKIPPED");
  });
  it("hands the turn to the previous player at a four-player table", () => {
    const g = setup({
      hands: {
        a: ["red-reverse", "red-1", "red-2"],
        b: ["blue-1", "blue-2"],
        c: ["blue-3", "blue-4"],
        d: ["blue-6", "blue-7"],
      },
      top: "red-5",
    });
    expect(
      currentId(run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-reverse") })).state),
    ).toBe("d");
  });
  it("continues in the new direction on the following turn", () => {
    const g = setup({
      hands: {
        a: ["red-reverse", "red-1", "red-2"],
        b: ["blue-1", "blue-2"],
        c: ["red-3", "red-4", "red-6"],
      },
      top: "red-5",
    });
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-reverse") })).state;
    const { state, events } = run(s1, cmd("PLAY_CARD", "c", { cardId: g.id("red-3") }));
    expect(currentId(state)).toBe("b");
    expect(find(events, "TURN_CHANGED").direction).toBe(-1);
  });
  it("plays on another Reverse of a different colour", () => {
    const g = setup({
      hands: {
        a: ["blue-reverse", "blue-1", "blue-2"],
        b: ["blue-3", "blue-4"],
        c: ["blue-6", "blue-7"],
      },
      top: "red-reverse",
    });
    expect(
      run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("blue-reverse") })).state.direction,
    ).toBe(-1);
  });
});

describe("Draw Two", () => {
  it("makes the next player draw two and lose their turn", () => {
    const g = three(["red-draw_two", "red-1", "red-2"]);
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") }));
    expect(handOf(state, "b")).toHaveLength(5);
    expect(handOf(state, "b").slice(3)).toEqual([g.id("yellow-1"), g.id("yellow-2")]);
    expect(currentId(state)).toBe("c");
    expect(types(events)).toEqual(["CARD_PLAYED", "CARDS_DRAWN", "PLAYER_SKIPPED", "TURN_CHANGED"]);
    expect(find(events, "CARDS_DRAWN")).toEqual({
      type: "CARDS_DRAWN",
      playerId: "b",
      count: 2,
      cardIds: [g.id("yellow-1"), g.id("yellow-2")],
      reason: "draw_two",
    });
    expect(find(events, "PLAYER_SKIPPED").reason).toBe("draw_two");
    expectConserved(state);
  });
  it("hits the previous player when going counter-clockwise", () => {
    const g = three(["red-draw_two", "red-1", "red-2"], { direction: -1 });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") }));
    expect(handOf(state, "c")).toHaveLength(5);
    expect(currentId(state)).toBe("b");
  });
  it("does not stack: the victim cannot answer with their own Draw Two", () => {
    const g = setup({
      hands: {
        a: ["red-draw_two", "red-1", "red-2"],
        b: ["blue-draw_two", "blue-1"],
        c: ["green-1", "green-2", "green-3"],
      },
      top: "red-5",
      draw: ["yellow-1", "yellow-2"],
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") }));
    expect(handOf(state, "b")).toHaveLength(4);
    expectRejected(
      state,
      cmd("PLAY_CARD", "b", { cardId: g.id("blue-draw_two") }),
      "NOT_YOUR_TURN",
    );
  });
  it("plays on a Draw Two of another colour", () => {
    const g = setup({
      hands: {
        a: ["blue-draw_two", "blue-1", "blue-2"],
        b: ["blue-3", "blue-4"],
        c: ["blue-6", "blue-7"],
      },
      top: "red-draw_two",
      draw: ["yellow-1", "yellow-2"],
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("blue-draw_two") }));
    expect(state.activeColor).toBe("blue");
    expect(handOf(state, "b")).toHaveLength(4);
  });
  it("the victim keeps their previous cards", () => {
    const g = three(["red-draw_two", "red-1", "red-2"]);
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") }));
    expect(handOf(state, "b").slice(0, 3)).toEqual([
      g.id("blue-1"),
      g.id("blue-2"),
      g.id("blue-3"),
    ]);
  });
  it("draws from the reshuffled pile when it runs short", () => {
    const g = three(["red-draw_two", "red-1", "red-2"], {
      fillerTo: "discard",
      draw: ["yellow-1"],
    });
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") }));
    expect(handOf(state, "b")).toHaveLength(5);
    expect(types(events)).toContain("DRAW_PILE_RESHUFFLED");
    expectConserved(state);
  });
});

describe("Wild", () => {
  it.each(["red", "yellow", "green", "blue"] as const)("lets the player choose %s", (color) => {
    const g = three(["wild", "red-1", "red-2"]);
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wild"), color }));
    expect(state.activeColor).toBe(color);
    expect(find(events, "COLOR_CHOSEN").color).toBe(color);
    expect(currentId(state)).toBe("b");
  });
  it("can be played on anything, even with a matching card in hand", () => {
    const g = three(["wild", "red-1", "red-2"]);
    expect(
      types(run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wild"), color: "red" })).events),
    ).toEqual(["CARD_PLAYED", "COLOR_CHOSEN", "TURN_CHANGED"]);
  });
  it("keeps the previous top card number irrelevant: next player matches only the chosen colour", () => {
    const g = setup({
      hands: {
        a: ["wild", "red-1", "red-2"],
        b: ["red-5#2", "green-4", "green-5"],
        c: ["blue-1", "blue-2"],
      },
      top: "red-5",
    });
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wild"), color: "green" })).state;
    expectRejected(s1, cmd("PLAY_CARD", "b", { cardId: g.id("red-5#2") }), "CARD_NOT_PLAYABLE");
  });
});
