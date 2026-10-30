import { describe, expect, it } from "vitest";
import { cmd, currentId, expectRejected, find, handOf, run, setup, types } from "./test-helpers";

const DRAW = [
  "green-1",
  "green-2",
  "green-3",
  "green-4",
  "green-6",
  "green-7",
  "green-8",
  "green-9",
];
const three = (
  a: string[],
  b = ["blue-1", "blue-2", "blue-3"],
  c = ["yellow-1", "yellow-2", "yellow-3"],
) => setup({ variant: "no_mercy", hands: { a, b, c }, top: "red-5", draw: DRAW });
const duel = (a: string[], b = ["blue-1", "blue-2", "blue-3"]) =>
  setup({ variant: "no_mercy", hands: { a, b }, top: "red-5", draw: DRAW });

describe("Wild Reverse Draw Four (three or more players)", () => {
  it("reverses, adds four, and sends the stack to the previous player", () => {
    const g = three(["wrd4", "green-5", "red-2"]);
    const { state, events } = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("wrd4"), color: "blue" }),
    );
    expect(state.direction).toBe(-1);
    expect(currentId(state)).toBe("c");
    expect(state.pendingPenalty).toEqual({ total: 4, topValue: 4 });
    expect(state.activeColor).toBe("blue");
    expect(types(events)).toEqual([
      "CARD_PLAYED",
      "COLOR_CHOSEN",
      "DIRECTION_REVERSED",
      "PENALTY_PENDING",
      "TURN_CHANGED",
    ]);
    expect(find(events, "DIRECTION_REVERSED").direction).toBe(-1);
    expect(find(events, "PENALTY_PENDING")).toMatchObject({ playerId: "c", total: 4, topValue: 4 });
  });
  it("needs a colour", () => {
    const g = three(["wrd4", "green-5", "red-2"]);
    expectRejected(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wrd4") }), "COLOR_REQUIRED");
  });
  it("the victim who draws loses their turn, and play continues in the new direction", () => {
    const g = three(["wrd4", "green-5", "red-2"]);
    const faced = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("wrd4"), color: "blue" }),
    ).state;
    const { state } = run(faced, cmd("DRAW_CARD", "c"));
    expect(handOf(state, "c")).toHaveLength(7);
    expect(currentId(state)).toBe("b");
    expect(state.direction).toBe(-1);
  });
  it("can be stacked with a Draw Six, which continues in the new direction", () => {
    const g = three(["wrd4", "green-5", "red-2"], undefined, ["wd6", "yellow-1"]);
    const faced = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("wrd4"), color: "blue" }),
    ).state;
    const { state } = run(faced, cmd("PLAY_CARD", "c", { cardId: g.id("wd6"), color: "green" }));
    expect(state.pendingPenalty).toEqual({ total: 10, topValue: 6 });
    expect(state.direction).toBe(-1);
    expect(currentId(state)).toBe("b");
  });
  it("a second Reverse Draw Four reverses again and sends the stack back", () => {
    const g = three(["wrd4", "green-5", "red-2"], undefined, ["wrd4#2", "yellow-1"]);
    const faced = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("wrd4"), color: "blue" }),
    ).state;
    const { state, events } = run(
      faced,
      cmd("PLAY_CARD", "c", { cardId: g.id("wrd4#2"), color: "yellow" }),
    );
    expect(state.pendingPenalty).toEqual({ total: 8, topValue: 4 });
    expect(state.direction).toBe(1);
    expect(currentId(state)).toBe("a");
    expect(find(events, "DIRECTION_REVERSED").direction).toBe(1);
  });
  it("can be stacked onto a +2 (value 4 beats 2) and reverses", () => {
    const g = three(["red-draw_two", "green-5", "red-2"], ["wrd4", "blue-1"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    const { state } = run(faced, cmd("PLAY_CARD", "b", { cardId: g.id("wrd4"), color: "red" }));
    expect(state.pendingPenalty).toEqual({ total: 6, topValue: 4 });
    expect(state.direction).toBe(-1);
    expect(currentId(state)).toBe("a");
  });
  it("cannot be stacked onto a Draw Six", () => {
    const g = three(["wd6", "green-5", "red-2"], ["wrd4", "blue-1"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wd6"), color: "red" })).state;
    expectRejected(
      faced,
      cmd("PLAY_CARD", "b", { cardId: g.id("wrd4"), color: "red" }),
      "STACK_TOO_LOW",
    );
  });
  it("as the last card the previous player takes the four and the hand ends", () => {
    const g = three(["wrd4"]);
    const { state, events } = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("wrd4"), color: "blue" }),
    );
    expect(types(events)).toEqual([
      "CARD_PLAYED",
      "COLOR_CHOSEN",
      "DIRECTION_REVERSED",
      "CARDS_DRAWN",
      "HAND_WON",
      "MATCH_ENDED",
    ]);
    expect(find(events, "CARDS_DRAWN")).toMatchObject({
      playerId: "c",
      count: 4,
      reason: "penalty",
    });
    expect(state.phase).toBe("match_over");
  });
  it("is playable on anything, including after a draw-until-play", () => {
    const g = setup({
      variant: "no_mercy",
      hands: { a: ["green-1", "green-2"], b: ["blue-1", "blue-2"], c: ["yellow-1", "yellow-2"] },
      top: "red-5",
      draw: ["green-3", "wrd4"],
    });
    const drew = run(g.state, cmd("DRAW_CARD", "a")).state;
    expect(drew.drawnCardId).toBe(g.id("wrd4"));
    const { state } = run(drew, cmd("PLAY_CARD", "a", { cardId: g.id("wrd4"), color: "red" }));
    expect(state.pendingPenalty).toEqual({ total: 4, topValue: 4 });
  });
});

describe("Wild Reverse Draw Four with two players", () => {
  it("acts as a skip: the player who played it faces the penalty themselves", () => {
    const g = duel(["wrd4", "green-5", "red-2"]);
    const { state, events } = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("wrd4"), color: "blue" }),
    );
    expect(currentId(state)).toBe("a");
    expect(state.phase).toBe("facing_penalty");
    expect(state.direction).toBe(-1);
    expect(state.pendingPenalty).toEqual({ total: 4, topValue: 4 });
    expect(types(events)).toEqual([
      "CARD_PLAYED",
      "COLOR_CHOSEN",
      "DIRECTION_REVERSED",
      "PENALTY_PENDING",
      "TURN_CHANGED",
    ]);
    expect(find(events, "PENALTY_PENDING").playerId).toBe("a");
  });
  it("drawing the four ends their turn and the opponent plays", () => {
    const g = duel(["wrd4", "green-5", "red-2"]);
    const faced = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("wrd4"), color: "blue" }),
    ).state;
    const { state, events } = run(faced, cmd("DRAW_CARD", "a"));
    expect(handOf(state, "a")).toHaveLength(6);
    expect(currentId(state)).toBe("b");
    expect(types(events)).toEqual(["CARDS_DRAWN", "TURN_CHANGED"]);
  });
  it("they may stack a +4 to send the penalty to the opponent", () => {
    const g = duel(["wrd4", "red-draw_four", "red-2"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wrd4"), color: "red" })).state;
    const { state } = run(faced, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_four") }));
    expect(state.pendingPenalty).toEqual({ total: 8, topValue: 4 });
    expect(currentId(state)).toBe("b");
    expect(state.direction).toBe(-1);
  });
  it("stacking a second Reverse Draw Four reverses again and lands on themselves again", () => {
    const g = duel(["wrd4", "wrd4#2", "red-2"]);
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wrd4"), color: "red" })).state;
    const { state } = run(faced, cmd("PLAY_CARD", "a", { cardId: g.id("wrd4#2"), color: "red" }));
    expect(state.direction).toBe(1);
    expect(currentId(state)).toBe("a");
    expect(state.pendingPenalty).toEqual({ total: 8, topValue: 4 });
  });
  it("only the facing player (themselves) can respond", () => {
    const g = duel(["wrd4", "green-5", "red-2"]);
    const faced = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("wrd4"), color: "blue" }),
    ).state;
    expectRejected(faced, cmd("DRAW_CARD", "b"), "NOT_YOUR_TURN");
  });
});
