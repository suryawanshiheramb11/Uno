import { describe, expect, it } from "vitest";
import { getPublicView } from "./views";
import { getLegalMoves } from "./rules";
import { cmd, currentId, expectRejected, find, handOf, run, setup, types } from "./test-helpers";

const DRAW = ["yellow-1", "yellow-2", "yellow-3", "yellow-4", "yellow-5"];
const atTwo = (extra: Partial<Parameters<typeof setup>[0]> = {}) =>
  setup({
    hands: {
      a: ["red-7", "red-8"],
      b: ["blue-1", "blue-2", "blue-3"],
      c: ["green-1", "green-2", "green-3"],
    },
    top: "red-5",
    draw: DRAW,
    ...extra,
  });
/** a plays down to one card at t=1000 without calling UNO. */
const atOne = (extra: Partial<Parameters<typeof setup>[0]> = {}) => {
  const g = atTwo(extra);
  return { g, ...run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") }, 1000)) };
};

describe("playing down to one card", () => {
  it("opens a UNO window stamped with the command time", () => {
    const { state, events } = atOne();
    expect(state.unoWindow).toEqual({ playerId: "a", openedAt: 1000 });
    expect(state.players[0]?.unoCalled).toBe(false);
    expect(types(events)).toEqual(["CARD_PLAYED", "TURN_CHANGED"]);
  });
  it("exposes the window end in the public view", () => {
    const { state } = atOne();
    expect(getPublicView(state).unoWindow).toEqual({ playerId: "a", closesAt: 4000 });
  });
  it("calling UNO with the play skips the window", () => {
    const g = atTwo();
    const { state, events } = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("red-7"), callUno: true }, 1000),
    );
    expect(state.unoWindow).toBeNull();
    expect(state.players[0]?.unoCalled).toBe(true);
    expect(types(events)).toEqual(["CARD_PLAYED", "UNO_CALLED", "TURN_CHANGED"]);
  });
  it("ignores callUno when the play does not leave one card", () => {
    const g = setup({
      hands: { a: ["red-7", "red-8", "red-9"], b: ["blue-1", "blue-2"], c: ["green-1", "green-2"] },
      top: "red-5",
    });
    const { state, events } = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("red-7"), callUno: true }),
    );
    expect(state.players[0]?.unoCalled).toBe(false);
    expect(state.unoWindow).toBeNull();
    expect(types(events)).not.toContain("UNO_CALLED");
  });
  it("opens the window when the last-but-one card is the drawn card", () => {
    const g = setup({
      hands: {
        a: ["red-9"],
        b: ["blue-1", "blue-2", "blue-3"],
        c: ["green-1", "green-2", "green-3"],
      },
      top: "red-5",
      draw: ["red-8"],
    });
    const drew = run(g.state, cmd("DRAW_CARD", "a")).state;
    const { state } = run(drew, cmd("PLAY_CARD", "a", { cardId: g.id("red-8") }, 2500));
    expect(state.unoWindow).toEqual({ playerId: "a", openedAt: 2500 });
  });
});

describe("calling UNO", () => {
  it("a standalone call inside the window marks the player safe", () => {
    const { state } = atOne();
    const res = run(state, cmd("CALL_UNO", "a", {}, 1500));
    expect(res.state.players[0]?.unoCalled).toBe(true);
    expect(res.state.unoWindow).toBeNull();
    expect(res.events).toEqual([{ type: "UNO_CALLED", playerId: "a" }]);
  });
  it("cannot be caught after calling", () => {
    const { state } = atOne();
    const called = run(state, cmd("CALL_UNO", "a", {}, 1500)).state;
    expectRejected(called, cmd("CATCH_UNO", "b", { targetId: "a" }, 1600), "NOTHING_TO_CATCH");
  });
  it("is rejected with more than one card", () => {
    const g = atTwo();
    expectRejected(g.state, cmd("CALL_UNO", "a"), "NOT_AT_UNO");
  });
  it("is rejected a second time", () => {
    const { state } = atOne();
    const called = run(state, cmd("CALL_UNO", "a", {}, 1500)).state;
    expectRejected(called, cmd("CALL_UNO", "a", {}, 1600), "ALREADY_CALLED_UNO");
  });
  it("is rejected before a hand starts", () => {
    const g = atTwo({ phase: "pre_hand" });
    expectRejected(g.state, cmd("CALL_UNO", "a"), "WRONG_PHASE");
  });
  it("is listed as a legal move only for the player at one card", () => {
    const { state } = atOne();
    expect(getLegalMoves(state, "a").some((m) => m.type === "CALL_UNO")).toBe(true);
    expect(getLegalMoves(state, "b").some((m) => m.type === "CALL_UNO")).toBe(false);
  });
});

describe("catching UNO", () => {
  it("makes the player draw two inside the window", () => {
    const { g, state } = atOne();
    const res = run(state, cmd("CATCH_UNO", "b", { targetId: "a" }, 2000));
    expect(handOf(res.state, "a")).toHaveLength(3);
    expect(handOf(res.state, "a").slice(1)).toEqual([g.id("yellow-1"), g.id("yellow-2")]);
    expect(res.state.unoWindow).toBeNull();
    expect(res.state.players[0]?.unoCalled).toBe(false);
    expect(types(res.events)).toEqual(["UNO_CAUGHT", "CARDS_DRAWN"]);
    expect(res.events[0]).toEqual({ type: "UNO_CAUGHT", catcherId: "b", targetId: "a" });
    expect(find(res.events, "CARDS_DRAWN")).toMatchObject({
      playerId: "a",
      count: 2,
      reason: "uno_penalty",
    });
    expect(currentId(res.state)).toBe("b");
  });
  it("works at exactly the window boundary", () => {
    const { state } = atOne();
    expect(types(run(state, cmd("CATCH_UNO", "b", { targetId: "a" }, 4000)).events)).toContain(
      "UNO_CAUGHT",
    );
  });
  it("is too late one millisecond after the window", () => {
    const { state } = atOne();
    expectRejected(state, cmd("CATCH_UNO", "b", { targetId: "a" }, 4001), "UNO_WINDOW_CLOSED");
  });
  it("any other player may catch, not only the next one", () => {
    const { state } = atOne();
    expect(types(run(state, cmd("CATCH_UNO", "c", { targetId: "a" }, 2000)).events)).toContain(
      "UNO_CAUGHT",
    );
  });
  it("closes once the next player acts (draw)", () => {
    const { state } = atOne();
    const after = run(state, cmd("DRAW_CARD", "b", {}, 1200)).state;
    expectRejected(after, cmd("CATCH_UNO", "c", { targetId: "a" }, 1300), "UNO_WINDOW_CLOSED");
  });
  it("closes once the next player plays a card", () => {
    const g = setup({
      hands: {
        a: ["red-7", "red-8"],
        b: ["red-1", "red-2", "red-3"],
        c: ["green-1", "green-2", "green-3"],
      },
      top: "red-5",
    });
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") }, 1000)).state;
    const s2 = run(s1, cmd("PLAY_CARD", "b", { cardId: g.id("red-1") }, 1100)).state;
    expect(s2.unoWindow).toBeNull();
    expectRejected(s2, cmd("CATCH_UNO", "c", { targetId: "a" }, 1200), "UNO_WINDOW_CLOSED");
  });
  it("cannot catch yourself", () => {
    const { state } = atOne();
    expectRejected(state, cmd("CATCH_UNO", "a", { targetId: "a" }, 1100), "CANNOT_CATCH_SELF");
  });
  it("cannot catch an unknown player", () => {
    const { state } = atOne();
    expectRejected(state, cmd("CATCH_UNO", "b", { targetId: "zed" }, 1100), "UNKNOWN_PLAYER");
  });
  it("cannot catch a player who is not at one card", () => {
    const { state } = atOne();
    expectRejected(state, cmd("CATCH_UNO", "b", { targetId: "c" }, 1100), "NOTHING_TO_CATCH");
  });
  it("a caught player cannot be caught twice", () => {
    const { state } = atOne();
    const caught = run(state, cmd("CATCH_UNO", "b", { targetId: "a" }, 2000)).state;
    expectRejected(caught, cmd("CATCH_UNO", "c", { targetId: "a" }, 2100), "NOTHING_TO_CATCH");
  });
  it("lists CATCH_UNO for others while the window is open", () => {
    const { state } = atOne();
    expect(getLegalMoves(state, "b")).toContainEqual({ type: "CATCH_UNO", targetId: "a" });
    expect(getLegalMoves(state, "a").some((m) => m.type === "CATCH_UNO")).toBe(false);
  });
  it("honours a custom window length", () => {
    const { state } = atOne({ config: { unoWindowMs: 1000 } });
    expect(types(run(state, cmd("CATCH_UNO", "b", { targetId: "a" }, 2000)).events)).toContain(
      "UNO_CAUGHT",
    );
    expectRejected(state, cmd("CATCH_UNO", "b", { targetId: "a" }, 2001), "UNO_WINDOW_CLOSED");
  });
  it("honours a custom penalty", () => {
    const { state } = atOne({ config: { unoPenalty: 4 } });
    const res = run(state, cmd("CATCH_UNO", "b", { targetId: "a" }, 1500));
    expect(handOf(res.state, "a")).toHaveLength(5);
    expect(find(res.events, "CARDS_DRAWN").count).toBe(4);
  });
  it("is rejected outside a hand", () => {
    const g = atTwo({ phase: "hand_over" });
    expectRejected(g.state, cmd("CATCH_UNO", "b", { targetId: "a" }), "WRONG_PHASE");
  });
});

describe("UNO state reset", () => {
  it("clears the called flag when the player draws back to two cards", () => {
    const g = setup({
      hands: { a: ["blue-1"], b: ["blue-2", "blue-3"], c: ["green-1", "green-2"] },
      top: "red-5",
      draw: ["yellow-1"],
      unoCalled: ["a"],
    });
    const { state } = run(g.state, cmd("DRAW_CARD", "a"));
    expect(state.players[0]?.unoCalled).toBe(false);
    expect(handOf(state, "a")).toHaveLength(2);
  });
  it("a penalty draw also clears the window", () => {
    const { state } = atOne();
    const caught = run(state, cmd("CATCH_UNO", "b", { targetId: "a" }, 1500)).state;
    expect(caught.unoWindow).toBeNull();
  });
  it("a Draw Two that hits a player at one card removes their window", () => {
    const g = setup({
      hands: { a: ["red-draw_two", "red-1", "red-2"], b: ["blue-1"], c: ["green-1", "green-2"] },
      top: "red-5",
      draw: ["yellow-1", "yellow-2"],
      unoWindow: { playerId: "b", openedAt: 0 },
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") }, 500));
    expect(state.unoWindow).toBeNull();
    expect(handOf(state, "b")).toHaveLength(3);
  });
});
