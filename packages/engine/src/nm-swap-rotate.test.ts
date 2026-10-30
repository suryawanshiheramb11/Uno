import { describe, expect, it } from "vitest";
import { getLegalMoves } from "./rules";
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

const DRAW = ["green-3", "green-4", "red-9", "red-8"];
const three = (
  a: string[],
  b = ["blue-1", "blue-2"],
  c = ["yellow-1", "yellow-2", "yellow-3"],
  extra: Partial<Parameters<typeof setup>[0]> = {},
) => setup({ variant: "no_mercy", hands: { a, b, c }, top: "red-5", draw: DRAW, ...extra });

describe("7: swap hands", () => {
  const base = () => three(["red-7", "green-1", "green-2"]);
  const awaiting = () => {
    const g = base();
    return { g, ...run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") })) };
  };

  it("playing a 7 asks the player to choose a swap target", () => {
    const { g, state, events } = awaiting();
    expect(state.phase).toBe("awaiting_swap_target");
    expect(state.swapTargetAwaiting).toEqual({ playerId: "a" });
    expect(currentId(state)).toBe("a");
    expect(types(events)).toEqual(["CARD_PLAYED", "SWAP_TARGET_REQUESTED"]);
    expect(state.discardPile.at(-1)).toBe(g.id("red-7"));
    expect(state.activeColor).toBe("red");
  });
  it("the swap exchanges the two hands atomically and passes the turn", () => {
    const { g, state } = awaiting();
    const res = run(state, cmd("CHOOSE_SWAP_TARGET", "a", { targetId: "b" }));
    expect(handOf(res.state, "a")).toEqual([g.id("blue-1"), g.id("blue-2")]);
    expect(handOf(res.state, "b")).toEqual([g.id("green-1"), g.id("green-2")]);
    expect(res.state.swapTargetAwaiting).toBeNull();
    expect(res.state.phase).toBe("awaiting_play_or_draw");
    expect(currentId(res.state)).toBe("b");
    expect(types(res.events)).toEqual(["HANDS_SWAPPED", "TURN_CHANGED"]);
    expect(res.events[0]).toEqual({ type: "HANDS_SWAPPED", a: "a", b: "b" });
    expectConserved(res.state);
  });
  it("can swap with any other active player", () => {
    const { g, state } = awaiting();
    const res = run(state, cmd("CHOOSE_SWAP_TARGET", "a", { targetId: "c" }));
    expect(handOf(res.state, "a")).toEqual([g.id("yellow-1"), g.id("yellow-2"), g.id("yellow-3")]);
    expect(handOf(res.state, "c")).toHaveLength(2);
    expect(currentId(res.state)).toBe("b");
  });
  it("cannot swap with yourself or an unknown player", () => {
    const { state } = awaiting();
    expectRejected(state, cmd("CHOOSE_SWAP_TARGET", "a", { targetId: "a" }), "INVALID_SWAP_TARGET");
    expectRejected(
      state,
      cmd("CHOOSE_SWAP_TARGET", "a", { targetId: "zed" }),
      "INVALID_SWAP_TARGET",
    );
  });
  it("cannot swap with an eliminated player", () => {
    const g = three(["red-7", "green-1", "green-2"], undefined, undefined, { eliminated: ["c"] });
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") })).state;
    expectRejected(s1, cmd("CHOOSE_SWAP_TARGET", "a", { targetId: "c" }), "INVALID_SWAP_TARGET");
    expect(getLegalMoves(s1, "a").filter((m) => m.type === "CHOOSE_SWAP_TARGET")).toEqual([
      { type: "CHOOSE_SWAP_TARGET", targetId: "b" },
    ]);
  });
  it("cannot swap with a player who resigned", () => {
    const { state } = awaiting();
    const gone = run(state, cmd("RESIGN", "c")).state;
    expectRejected(gone, cmd("CHOOSE_SWAP_TARGET", "a", { targetId: "c" }), "INVALID_SWAP_TARGET");
  });
  it("only the player who played the 7 chooses", () => {
    const { state } = awaiting();
    expectRejected(state, cmd("CHOOSE_SWAP_TARGET", "b", { targetId: "a" }), "NOT_YOUR_TURN");
  });
  it("a swap target cannot be chosen when none is pending", () => {
    expectRejected(
      base().state,
      cmd("CHOOSE_SWAP_TARGET", "a", { targetId: "b" }),
      "NO_SWAP_PENDING",
    );
  });
  it("nothing else can happen while the choice is pending", () => {
    const { g, state } = awaiting();
    expectRejected(
      state,
      cmd("PLAY_CARD", "a", { cardId: g.id("green-1") }),
      "SWAP_TARGET_PENDING",
    );
    expectRejected(state, cmd("DRAW_CARD", "a"), "SWAP_TARGET_PENDING");
    expectRejected(state, cmd("PASS_TURN", "a"), "SWAP_TARGET_PENDING");
  });
  it("getLegalMoves offers exactly the valid targets", () => {
    const { state } = awaiting();
    expect(getLegalMoves(state, "a")).toEqual([
      { type: "CHOOSE_SWAP_TARGET", targetId: "b" },
      { type: "CHOOSE_SWAP_TARGET", targetId: "c" },
      { type: "RESIGN" },
      { type: "REQUEST_SNAPSHOT" },
    ]);
    expect(getLegalMoves(state, "b").map((m) => m.type)).toEqual(["RESIGN", "REQUEST_SNAPSHOT"]);
  });
  it("a 7 may be played on a 7 of another colour", () => {
    const g = setup({
      variant: "no_mercy",
      hands: {
        a: ["blue-7", "green-1", "green-2"],
        b: ["blue-1", "blue-2"],
        c: ["yellow-1", "yellow-2"],
      },
      top: "red-7",
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("blue-7") }));
    expect(state.phase).toBe("awaiting_swap_target");
    expect(state.activeColor).toBe("blue");
  });
  it("a 7 cannot answer a pending penalty", () => {
    const g = three(["red-draw_two", "green-1", "green-2"], ["blue-7", "blue-1"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    expectRejected(faced, cmd("PLAY_CARD", "b", { cardId: g.id("blue-7") }), "MUST_STACK_OR_DRAW");
  });
  it("with two players the only opponent must still be chosen explicitly", () => {
    const g = setup({
      variant: "no_mercy",
      hands: { a: ["red-7", "green-1", "green-2"], b: ["blue-1"] },
      top: "red-5",
    });
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") })).state;
    expect(getLegalMoves(s1, "a")[0]).toEqual({ type: "CHOOSE_SWAP_TARGET", targetId: "b" });
    const { state } = run(s1, cmd("CHOOSE_SWAP_TARGET", "a", { targetId: "b" }));
    expect(handOf(state, "a")).toEqual([g.id("blue-1")]);
    expect(currentId(state)).toBe("b");
  });
  it("a 7 played as the last card wins immediately with no swap", () => {
    const g = three(["red-7"]);
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") }));
    expect(types(events)).toEqual(["CARD_PLAYED", "HAND_WON", "MATCH_ENDED"]);
    expect(state.swapTargetAwaiting).toBeNull();
    expect(state.phase).toBe("match_over");
  });
  it("is an ordinary number card when sevenZeroRules is off", () => {
    const g = three(["red-7", "green-1", "green-2"], undefined, undefined, {
      config: { sevenZeroRules: false },
    });
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") }));
    expect(types(events)).toEqual(["CARD_PLAYED", "TURN_CHANGED"]);
    expect(state.phase).toBe("awaiting_play_or_draw");
  });
  it("resigning while the choice is pending voids it", () => {
    const { state } = awaiting();
    const { state: after } = run(state, cmd("RESIGN", "a"));
    expect(after.swapTargetAwaiting).toBeNull();
    expect(after.phase).toBe("awaiting_play_or_draw");
    expect(currentId(after)).toBe("b");
  });
});

describe("7: UNO after a swap", () => {
  const oneEach = (extra: Partial<Parameters<typeof setup>[0]> = {}) => {
    const g = three(["red-7", "green-1"], ["blue-1"], undefined, extra);
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") }, 1000)).state;
    return { g, s1, ...run(s1, cmd("CHOOSE_SWAP_TARGET", "a", { targetId: "b" }, 2000)) };
  };
  it("both players left on one card get a UNO window and the 7-player's own window is replaced", () => {
    const { s1, state } = oneEach();
    expect(s1.unoWindow).toEqual({ playerId: "a", openedAt: 1000 });
    expect(state.unoWindow).toBeNull();
    expect(state.unoPending).toEqual([
      { playerId: "a", openedAt: 2000 },
      { playerId: "b", openedAt: 2000 },
    ]);
    expect(state.players[0]?.unoCalled).toBe(false);
    expect(state.players[1]?.unoCalled).toBe(false);
  });
  it("the swapped-out player is catchable and draws two", () => {
    const { g, state } = oneEach();
    const res = run(state, cmd("CATCH_UNO", "c", { targetId: "b" }, 3000));
    expect(types(res.events)).toEqual(["UNO_CAUGHT", "CARDS_DRAWN"]);
    expect(find(res.events, "CARDS_DRAWN")).toMatchObject({
      playerId: "b",
      count: 2,
      reason: "uno_penalty",
    });
    expect(handOf(res.state, "b")).toHaveLength(3);
    expect(handOf(res.state, "b")[0]).toBe(g.id("green-1"));
    expect(res.state.unoPending.map((w) => w.playerId)).toEqual(["a"]);
  });
  it("they can save themselves by calling UNO inside the window", () => {
    const { state } = oneEach();
    const called = run(state, cmd("CALL_UNO", "b", {}, 2500));
    expect(called.events).toEqual([{ type: "UNO_CALLED", playerId: "b" }]);
    expect(called.state.unoPending.map((w) => w.playerId)).toEqual(["a"]);
    expectRejected(
      called.state,
      cmd("CATCH_UNO", "c", { targetId: "b" }, 2600),
      "NOTHING_TO_CATCH",
    );
  });
  it("the catch window is the usual 3 seconds from the swap", () => {
    const { state } = oneEach();
    expect(types(run(state, cmd("CATCH_UNO", "c", { targetId: "a" }, 5000)).events)).toContain(
      "UNO_CAUGHT",
    );
    expectRejected(state, cmd("CATCH_UNO", "c", { targetId: "a" }, 5001), "UNO_WINDOW_CLOSED");
  });
  it("the next player acting closes everyone else's window but not their own", () => {
    const { state } = oneEach();
    const after = run(state, cmd("DRAW_CARD", "b", {}, 2100)).state;
    expect(after.unoPending).toEqual([]);
    expectRejected(after, cmd("CATCH_UNO", "c", { targetId: "a" }, 2200), "UNO_WINDOW_CLOSED");
  });
  it("a UNO already called before the swap does not carry over", () => {
    const g = three(["red-7", "green-1"], ["blue-1", "blue-2"]);
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7"), callUno: true })).state;
    expect(s1.players[0]?.unoCalled).toBe(true);
    const { state } = run(s1, cmd("CHOOSE_SWAP_TARGET", "a", { targetId: "b" }));
    expect(state.players[0]?.unoCalled).toBe(false);
    expect(state.players[1]?.unoCalled).toBe(false);
    expect(state.unoPending).toEqual([{ playerId: "b", openedAt: 1000 }]);
  });
  it("players not involved are unaffected", () => {
    const { state } = oneEach();
    expect(state.unoPending.some((w) => w.playerId === "c")).toBe(false);
  });
  it("public view exposes the pending windows with their end time", () => {
    const { state } = oneEach();
    expect(state.unoPending.map((w) => w.openedAt + state.config.unoWindowMs)).toEqual([
      5000, 5000,
    ]);
  });
});

describe("0: rotate hands", () => {
  const ring = (extra: Partial<Parameters<typeof setup>[0]> = {}) =>
    three(
      ["red-0", "green-1", "green-2"],
      ["blue-1", "blue-2"],
      ["yellow-1", "yellow-2", "yellow-3", "yellow-4"],
      extra,
    );

  it("passes every hand to the next player in the current direction", () => {
    const g = ring();
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-0") }));
    expect(handOf(state, "b")).toEqual([g.id("green-1"), g.id("green-2")]);
    expect(handOf(state, "c")).toEqual([g.id("blue-1"), g.id("blue-2")]);
    expect(handOf(state, "a")).toEqual(
      ["yellow-1", "yellow-2", "yellow-3", "yellow-4"].map((s) => g.id(s)),
    );
    expect(types(events)).toEqual(["CARD_PLAYED", "HANDS_ROTATED", "TURN_CHANGED"]);
    expect(find(events, "HANDS_ROTATED")).toEqual({
      type: "HANDS_ROTATED",
      direction: 1,
      deltas: { a: 2, b: 0, c: -2 },
    });
    expect(currentId(state)).toBe("b");
    expectConserved(state);
  });
  it("rotates the other way when the direction is -1", () => {
    const g = ring({ direction: -1 });
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-0") }));
    expect(handOf(state, "c")).toEqual([g.id("green-1"), g.id("green-2")]);
    expect(handOf(state, "b")).toHaveLength(4);
    expect(handOf(state, "a")).toEqual([g.id("blue-1"), g.id("blue-2")]);
    expect(find(events, "HANDS_ROTATED")).toMatchObject({
      direction: -1,
      deltas: { a: 0, b: 2, c: -2 },
    });
    expect(currentId(state)).toBe("c");
  });
  it("the hand-size changes always sum to zero", () => {
    const g = ring();
    const { events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-0") }));
    const sum = Object.values(find(events, "HANDS_ROTATED").deltas).reduce((x, y) => x + y, 0);
    expect(sum).toBe(0);
  });
  it("with two players a rotation is a swap", () => {
    const g = setup({
      variant: "no_mercy",
      hands: { a: ["red-0", "green-1", "green-2"], b: ["blue-1", "blue-2", "blue-3", "blue-4"] },
      top: "red-5",
    });
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-0") }));
    expect(handOf(state, "a")).toHaveLength(4);
    expect(handOf(state, "b")).toEqual([g.id("green-1"), g.id("green-2")]);
    expect(find(events, "HANDS_ROTATED").deltas).toEqual({ a: 2, b: -2 });
    expect(currentId(state)).toBe("b");
  });
  it("works around a four-player table", () => {
    const g = setup({
      variant: "no_mercy",
      hands: {
        a: ["red-0", "green-1"],
        b: ["blue-1", "blue-2"],
        c: ["yellow-1", "yellow-2", "yellow-3"],
        d: ["red-1", "red-2", "red-3", "red-4"],
      },
      top: "red-5",
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-0") }));
    expect(handOf(state, "b")).toEqual([g.id("green-1")]);
    expect(handOf(state, "c")).toEqual([g.id("blue-1"), g.id("blue-2")]);
    expect(handOf(state, "d")).toHaveLength(3);
    expect(handOf(state, "a")).toHaveLength(4);
  });
  it("skips eliminated players", () => {
    const g = setup({
      variant: "no_mercy",
      hands: {
        a: ["red-0", "green-1", "green-2"],
        b: ["blue-1", "blue-2"],
        c: ["yellow-1", "yellow-2", "yellow-3", "yellow-4"],
        d: [],
      },
      top: "red-5",
      eliminated: ["d"],
    });
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-0") }));
    expect(handOf(state, "d")).toEqual([]);
    expect(handOf(state, "b")).toEqual([g.id("green-1"), g.id("green-2")]);
    expect(Object.keys(find(events, "HANDS_ROTATED").deltas).sort()).toEqual(["a", "b", "c"]);
  });
  it("a 0 played as the last card wins with no rotation", () => {
    const g = ring({
      hands: { a: ["red-0"], b: ["blue-1", "blue-2"], c: ["yellow-1", "yellow-2"] },
    });
    const { events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-0") }));
    expect(types(events)).toEqual(["CARD_PLAYED", "HAND_WON", "MATCH_ENDED"]);
  });
  it("is an ordinary number card when sevenZeroRules is off", () => {
    const g = ring({ config: { sevenZeroRules: false } });
    const { events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-0") }));
    expect(types(events)).toEqual(["CARD_PLAYED", "TURN_CHANGED"]);
  });
  it("cannot answer a pending penalty", () => {
    const g = three(["red-draw_two", "green-1", "green-2"], ["blue-0", "blue-1"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    expectRejected(faced, cmd("PLAY_CARD", "b", { cardId: g.id("blue-0") }), "MUST_STACK_OR_DRAW");
  });
  it("players left on one card by the rotation get a UNO window", () => {
    const g = ring({
      hands: {
        a: ["red-0", "green-1"],
        b: ["blue-1", "blue-2"],
        c: ["yellow-1", "yellow-2", "yellow-3", "yellow-4"],
      },
    });
    const s0 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-0") }, 1000));
    expect(s0.state.unoWindow).toBeNull();
    expect(s0.state.unoPending).toEqual([{ playerId: "b", openedAt: 1000 }]);
    expect(handOf(s0.state, "b")).toEqual([g.id("green-1")]);
    const caught = run(s0.state, cmd("CATCH_UNO", "c", { targetId: "b" }, 2000));
    expect(find(caught.events, "UNO_CAUGHT")).toEqual({
      type: "UNO_CAUGHT",
      catcherId: "c",
      targetId: "b",
    });
  });
  it("resets everyone's called-UNO flag", () => {
    const g = ring({
      hands: { a: ["red-0", "green-1"], b: ["blue-1"], c: ["yellow-1", "yellow-2"] },
      unoCalled: ["b"],
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-0") }));
    expect(state.players.every((p) => !p.unoCalled)).toBe(true);
  });
});
