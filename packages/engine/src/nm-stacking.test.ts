import { describe, expect, it } from "vitest";
import { getLegalMoves } from "./rules";
import { getPublicView } from "./snapshots";
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

const DRAW = [
  "green-1",
  "green-2",
  "green-3",
  "green-4",
  "green-6",
  "green-7",
  "green-8",
  "green-9",
  "green-0",
  "green-1#2",
  "green-2#2",
  "green-3#2",
  "green-4#2",
];

const table = (
  a: string[],
  b: string[] = ["blue-1", "blue-2", "blue-3"],
  c: string[] = ["yellow-1", "yellow-2", "yellow-3"],
  extra: Partial<Parameters<typeof setup>[0]> = {},
) => setup({ variant: "no_mercy", hands: { a, b, c }, top: "red-5", draw: DRAW, ...extra });

describe("starting a stack", () => {
  it("a +2 sets the pending penalty and hands the decision to the next player", () => {
    const g = table(["red-draw_two", "red-1", "red-2"]);
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") }));
    expect(state.pendingPenalty).toEqual({ total: 2, topValue: 2 });
    expect(state.phase).toBe("facing_penalty");
    expect(currentId(state)).toBe("b");
    expect(types(events)).toEqual(["CARD_PLAYED", "PENALTY_PENDING", "TURN_CHANGED"]);
    expect(find(events, "PENALTY_PENDING")).toEqual({
      type: "PENALTY_PENDING",
      playerId: "b",
      total: 2,
      topValue: 2,
    });
    expect(handOf(state, "b")).toHaveLength(3);
  });
  it("a +4 stacks 4", () => {
    const g = table(["red-draw_four", "red-1", "red-2"]);
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_four") }));
    expect(state.pendingPenalty).toEqual({ total: 4, topValue: 4 });
  });
  it("a Wild Draw Six needs a colour and sets it", () => {
    const g = table(["wd6", "red-1", "red-2"]);
    expectRejected(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wd6") }), "COLOR_REQUIRED");
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wd6"), color: "green" }));
    expect(state.pendingPenalty).toEqual({ total: 6, topValue: 6 });
    expect(state.activeColor).toBe("green");
  });
  it("a Wild Draw Ten stacks 10", () => {
    const g = table(["wd10", "red-1", "red-2"]);
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wd10"), color: "blue" }));
    expect(state.pendingPenalty).toEqual({ total: 10, topValue: 10 });
  });
  it("goes to the previous player when the direction is -1", () => {
    const g = table(["red-draw_two", "red-1", "red-2"], undefined, undefined, { direction: -1 });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") }));
    expect(currentId(state)).toBe("c");
  });
  it("shows the pending penalty and its target in the public view", () => {
    const g = table(["red-draw_two", "red-1", "red-2"]);
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") }));
    expect(getPublicView(state).pendingPenalty).toEqual({ total: 2, topValue: 2, targetId: "b" });
    expect(getPublicView(state).phase).toBe("facing_penalty");
  });
  it("a stacker left on one card gets a UNO window", () => {
    const g = table(["red-draw_two", "red-1"]);
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") }, 1234));
    expect(state.unoWindow).toEqual({ playerId: "a", openedAt: 1234 });
  });
});

describe("absorbing the penalty", () => {
  it("the victim draws the whole stack and loses their turn", () => {
    const g = table(["red-draw_two", "red-1", "red-2"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    const { state, events } = run(faced, cmd("DRAW_CARD", "b"));
    expect(types(events)).toEqual(["CARDS_DRAWN", "TURN_CHANGED"]);
    expect(find(events, "CARDS_DRAWN")).toEqual({
      type: "CARDS_DRAWN",
      playerId: "b",
      count: 2,
      cardIds: [g.id("green-1"), g.id("green-2")],
      reason: "penalty",
    });
    expect(handOf(state, "b")).toHaveLength(5);
    expect(currentId(state)).toBe("c");
    expect(state.pendingPenalty).toBeNull();
    expect(state.phase).toBe("awaiting_play_or_draw");
    expectConserved(state);
  });
  it("only the facing player may act", () => {
    const g = table(["red-draw_two", "red-1", "red-2"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    expectRejected(faced, cmd("DRAW_CARD", "c"), "NOT_YOUR_TURN");
    expectRejected(faced, cmd("DRAW_CARD", "a"), "NOT_YOUR_TURN");
  });
  it("cannot pass while facing a penalty", () => {
    const g = table(["red-draw_two", "red-1", "red-2"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    expectRejected(faced, cmd("PASS_TURN", "b"), "MUST_STACK_OR_DRAW");
  });
  it("draws from a reshuffled pile when the pile is short", () => {
    const g = table(["red-draw_four", "red-1", "red-2"], undefined, undefined, {
      fillerTo: "discard",
      draw: ["green-1", "green-2"],
    });
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_four") })).state;
    const { state, events } = run(faced, cmd("DRAW_CARD", "b"));
    expect(types(events)).toEqual(["DRAW_PILE_RESHUFFLED", "CARDS_DRAWN", "TURN_CHANGED"]);
    expect(handOf(state, "b")).toHaveLength(7);
    expectConserved(state);
  });
  it("a victim reaching 25 cards is eliminated mid-draw and the draw stops", () => {
    const g = setup({
      variant: "no_mercy",
      hands: { a: ["red-6"], b: junk(24), c: ["red-7", "red-8"] },
      top: "red-5",
      draw: ["red-1", "red-2", "red-3", "red-4"],
      current: "b",
      penalty: { total: 4, topValue: 4 },
    });
    const { state, events } = run(g.state, cmd("DRAW_CARD", "b"));
    expect(types(events)).toEqual(["CARDS_DRAWN", "PLAYER_ELIMINATED", "TURN_CHANGED"]);
    expect(find(events, "CARDS_DRAWN")).toMatchObject({
      playerId: "b",
      count: 1,
      reason: "penalty",
    });
    expect(state.eliminatedPlayerIds).toEqual(["b"]);
    expect(state.pendingPenalty).toBeNull();
    expect(currentId(state)).toBe("c");
    expectConserved(state);
  });
});

describe("stacking rules", () => {
  it("equal value is allowed, whatever the colour", () => {
    const g = table(["red-draw_two", "red-1", "red-2"], ["blue-draw_two", "blue-1"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    const { state, events } = run(faced, cmd("PLAY_CARD", "b", { cardId: g.id("blue-draw_two") }));
    expect(state.pendingPenalty).toEqual({ total: 4, topValue: 2 });
    expect(currentId(state)).toBe("c");
    expect(find(events, "PENALTY_PENDING")).toMatchObject({ playerId: "c", total: 4 });
    expect(state.activeColor).toBe("blue");
  });
  it("a higher value is allowed and raises the bar", () => {
    const g = table(["red-draw_two", "red-1", "red-2"], ["blue-draw_four", "blue-1"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    const { state } = run(faced, cmd("PLAY_CARD", "b", { cardId: g.id("blue-draw_four") }));
    expect(state.pendingPenalty).toEqual({ total: 6, topValue: 4 });
  });
  it("a lower value is rejected with STACK_TOO_LOW", () => {
    const g = table(["red-draw_four", "red-1", "red-2"], ["blue-draw_two", "blue-1"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_four") })).state;
    expectRejected(
      faced,
      cmd("PLAY_CARD", "b", { cardId: g.id("blue-draw_two") }),
      "STACK_TOO_LOW",
    );
  });
  it("+4 on +4 is allowed", () => {
    const g = table(["red-draw_four", "red-1", "red-2"], ["blue-draw_four", "blue-1"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_four") })).state;
    expect(
      run(faced, cmd("PLAY_CARD", "b", { cardId: g.id("blue-draw_four") })).state.pendingPenalty,
    ).toEqual({
      total: 8,
      topValue: 4,
    });
  });
  it("a Wild Draw Six may go on a +4", () => {
    const g = table(["red-draw_four", "red-1", "red-2"], ["wd6", "blue-1"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_four") })).state;
    const { state } = run(faced, cmd("PLAY_CARD", "b", { cardId: g.id("wd6"), color: "yellow" }));
    expect(state.pendingPenalty).toEqual({ total: 10, topValue: 6 });
    expect(state.activeColor).toBe("yellow");
  });
  it("a Wild Draw Six cannot go on a Wild Draw Ten", () => {
    const g = table(["wd10", "red-1", "red-2"], ["wd6", "blue-1"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wd10"), color: "red" })).state;
    expectRejected(
      faced,
      cmd("PLAY_CARD", "b", { cardId: g.id("wd6"), color: "red" }),
      "STACK_TOO_LOW",
    );
  });
  it("a Wild Draw Ten may go on a Wild Draw Ten", () => {
    const g = table(["wd10", "red-1", "red-2"], ["wd10#2", "blue-1"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wd10"), color: "red" })).state;
    expect(
      run(faced, cmd("PLAY_CARD", "b", { cardId: g.id("wd10#2"), color: "blue" })).state
        .pendingPenalty,
    ).toEqual({
      total: 20,
      topValue: 10,
    });
  });
  it("stacked wilds still need a colour", () => {
    const g = table(["red-draw_two", "red-1", "red-2"], ["wd6", "blue-1"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    expectRejected(faced, cmd("PLAY_CARD", "b", { cardId: g.id("wd6") }), "COLOR_REQUIRED");
  });
  it.each([
    ["a number", "blue-1"],
    ["a Skip", "blue-skip"],
    ["a Reverse", "blue-reverse"],
    ["a Discard All", "blue-discard_all"],
    ["a Skip Everyone", "blue-skip_everyone"],
    ["a Color Roulette", "roulette"],
  ])("%s cannot be played on a pending stack", (_name, spec) => {
    const g = table(["red-draw_two", "red-1", "red-2"], [spec, "blue-9"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    expectRejected(faced, cmd("PLAY_CARD", "b", { cardId: g.id(spec) }), "MUST_STACK_OR_DRAW");
  });
  it("a chain of three stacks adds up and the last victim draws it all", () => {
    const g = table(
      ["red-draw_two", "red-1", "red-2"],
      ["blue-draw_four", "blue-1"],
      ["wd6", "yellow-1"],
    );
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    const s2 = run(s1, cmd("PLAY_CARD", "b", { cardId: g.id("blue-draw_four") })).state;
    const s3 = run(s2, cmd("PLAY_CARD", "c", { cardId: g.id("wd6"), color: "green" })).state;
    expect(s3.pendingPenalty).toEqual({ total: 12, topValue: 6 });
    expect(currentId(s3)).toBe("a");
    const { state, events } = run(s3, cmd("DRAW_CARD", "a"));
    expect(find(events, "CARDS_DRAWN").count).toBe(12);
    expect(handOf(state, "a")).toHaveLength(14);
    expect(currentId(state)).toBe("b");
    expectConserved(state);
  });
  it("after the stack is absorbed, normal play resumes with the colour of the last stacker", () => {
    const g = table(
      ["red-draw_two", "red-1", "red-2"],
      ["blue-draw_two", "blue-1"],
      ["blue-9", "yellow-1"],
    );
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    const s2 = run(s1, cmd("PLAY_CARD", "b", { cardId: g.id("blue-draw_two") })).state;
    const s3 = run(s2, cmd("DRAW_CARD", "c")).state;
    expect(s3.activeColor).toBe("blue");
    expect(s3.phase).toBe("awaiting_play_or_draw");
    expect(currentId(s3)).toBe("a");
  });
});

describe("legal moves while facing a penalty", () => {
  it("lists only stack cards of at least the top value, plus drawing", () => {
    const g = table(
      ["red-draw_four", "red-1", "red-2"],
      ["blue-draw_two", "blue-draw_four", "blue-1", "wd6"],
    );
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_four") })).state;
    const moves = getLegalMoves(faced, "b");
    expect(
      moves.filter((m) => m.type === "PLAY_CARD").map((m) => (m as { cardId: string }).cardId),
    ).toEqual([g.id("blue-draw_four"), g.id("wd6")]);
    expect(moves.map((m) => m.type)).toEqual([
      "PLAY_CARD",
      "PLAY_CARD",
      "DRAW_CARD",
      "RESIGN",
      "REQUEST_SNAPSHOT",
    ]);
  });
  it("drawing is always allowed, even with a stack card in hand", () => {
    const g = table(["red-draw_two", "red-1", "red-2"], ["blue-draw_two", "blue-1"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    expect(getLegalMoves(faced, "b").some((m) => m.type === "DRAW_CARD")).toBe(true);
  });
  it("gives nobody else any gameplay move", () => {
    const g = table(["red-draw_two", "red-1", "red-2"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    expect(getLegalMoves(faced, "c").map((m) => m.type)).toEqual(["RESIGN", "REQUEST_SNAPSHOT"]);
  });
  it("going out with a penalty card ends the hand and the next player takes the stack", () => {
    const g = table(["red-draw_four"]);
    const { state, events } = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_four") }),
    );
    expect(types(events)).toEqual(["CARD_PLAYED", "CARDS_DRAWN", "HAND_WON", "MATCH_ENDED"]);
    expect(find(events, "CARDS_DRAWN")).toMatchObject({
      playerId: "b",
      count: 4,
      reason: "penalty",
    });
    expect(find(events, "HAND_WON").points).toBe(1 + 2 + 3 + (1 + 2 + 3 + 4) + (1 + 2 + 3));
    expect(state.pendingPenalty).toBeNull();
    expect(state.phase).toBe("match_over");
  });
});
