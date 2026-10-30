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

const DRAW = ["yellow-1", "yellow-2", "yellow-3", "yellow-4", "yellow-5", "yellow-6", "yellow-7"];

/** a holds a Wild Draw Four. `matching` gives a a red card (the active colour). */
const game = (matching: boolean, extra: Partial<Parameters<typeof setup>[0]> = {}) =>
  setup({
    hands: {
      a: matching ? ["wd4", "red-7", "green-1"] : ["wd4", "blue-5", "green-1"],
      b: ["blue-1", "blue-2", "blue-3"],
      c: ["green-2", "green-3", "green-4"],
    },
    top: "red-5",
    draw: DRAW,
    ...extra,
  });

const afterPlay = (matching: boolean, extra: Partial<Parameters<typeof setup>[0]> = {}) => {
  const g = game(matching, extra);
  const res = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wd4"), color: "green" }));
  return { g, ...res };
};

describe("playing Wild Draw Four", () => {
  it("opens a challenge window for the next player", () => {
    const { g, state, events } = afterPlay(false);
    expect(state.phase).toBe("awaiting_challenge");
    expect(currentId(state)).toBe("b");
    expect(state.activeColor).toBe("green");
    expect(state.pendingChallenge).toEqual({
      playedById: "a",
      targetId: "b",
      previousColor: "red",
      hadMatchingColor: false,
    });
    expect(types(events)).toEqual(["CARD_PLAYED", "COLOR_CHOSEN", "TURN_CHANGED"]);
    expect(find(events, "CARD_PLAYED").cardId).toBe(g.id("wd4"));
    expect(find(events, "TURN_CHANGED").playerId).toBe("b");
  });
  it("allows a bluff: playable while holding the active colour, flagged as illegal", () => {
    const { state } = afterPlay(true);
    expect(state.pendingChallenge?.hadMatchingColor).toBe(true);
  });
  it("a card matching only by number does not make the play illegal", () => {
    const g = setup({
      hands: {
        a: ["wd4", "blue-5", "green-1"],
        b: ["blue-1", "blue-2"],
        c: ["green-2", "green-3"],
      },
      top: "red-5",
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wd4"), color: "green" }));
    expect(state.pendingChallenge?.hadMatchingColor).toBe(false);
  });
  it("a plain Wild in hand does not count as a matching colour", () => {
    const g = setup({
      hands: { a: ["wd4", "wild", "green-1"], b: ["blue-1", "blue-2"], c: ["green-2", "green-3"] },
      top: "red-5",
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wd4"), color: "green" }));
    expect(state.pendingChallenge?.hadMatchingColor).toBe(false);
  });
  it("requires a colour", () => {
    const g = game(false);
    expectRejected(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wd4") }), "COLOR_REQUIRED");
  });
  it("the target cannot play a card while the challenge is pending", () => {
    const { g, state } = afterPlay(false);
    expectRejected(state, cmd("PLAY_CARD", "b", { cardId: g.id("blue-1") }), "CHALLENGE_PENDING");
  });
  it("the target cannot pass while the challenge is pending", () => {
    const { state } = afterPlay(false);
    expectRejected(state, cmd("PASS_TURN", "b"), "CHALLENGE_PENDING");
  });
  it("offers the target exactly: challenge or draw", () => {
    const { state } = afterPlay(false);
    expect(getLegalMoves(state, "b").map((m) => m.type)).toEqual([
      "CHALLENGE_WILD_DRAW_FOUR",
      "DRAW_CARD",
      "RESIGN",
      "REQUEST_SNAPSHOT",
    ]);
    expect(getLegalMoves(state, "c").map((m) => m.type)).toEqual(["RESIGN", "REQUEST_SNAPSHOT"]);
  });
});

describe("accepting (drawing four)", () => {
  it("target draws four and loses their turn", () => {
    const { g, state } = afterPlay(false);
    const res = run(state, cmd("DRAW_CARD", "b"));
    expect(handOf(res.state, "b")).toHaveLength(7);
    expect(handOf(res.state, "b").slice(3)).toEqual(DRAW.slice(0, 4).map((s) => g.id(s)));
    expect(currentId(res.state)).toBe("c");
    expect(res.state.pendingChallenge).toBeNull();
    expect(res.state.phase).toBe("awaiting_play_or_draw");
    expect(types(res.events)).toEqual(["CHALLENGE_DECLINED", "CARDS_DRAWN", "TURN_CHANGED"]);
    expect(find(res.events, "CARDS_DRAWN")).toMatchObject({
      playerId: "b",
      count: 4,
      reason: "wild_draw_four",
    });
    expectConserved(res.state);
  });
  it("the chosen colour stays active", () => {
    const { state } = afterPlay(false);
    expect(run(state, cmd("DRAW_CARD", "b")).state.activeColor).toBe("green");
  });
});

describe("challenging", () => {
  it("success (player held the colour): player draws four, challenger plays normally", () => {
    const { g, state } = afterPlay(true);
    const res = run(state, cmd("CHALLENGE_WILD_DRAW_FOUR", "b"));
    expect(handOf(res.state, "a")).toHaveLength(6);
    expect(handOf(res.state, "a").slice(2)).toEqual(DRAW.slice(0, 4).map((s) => g.id(s)));
    expect(handOf(res.state, "b")).toHaveLength(3);
    expect(currentId(res.state)).toBe("b");
    expect(res.state.phase).toBe("awaiting_play_or_draw");
    expect(res.state.activeColor).toBe("green");
    expect(res.state.pendingChallenge).toBeNull();
    expect(types(res.events)).toEqual(["CHALLENGE_RESOLVED", "CARDS_DRAWN", "TURN_CHANGED"]);
    expect(find(res.events, "CHALLENGE_RESOLVED")).toEqual({
      type: "CHALLENGE_RESOLVED",
      challengerId: "b",
      accusedId: "a",
      success: true,
    });
    expect(find(res.events, "CARDS_DRAWN")).toMatchObject({
      playerId: "a",
      count: 4,
      reason: "challenge_penalty",
    });
    expectConserved(res.state);
  });
  it("failure (play was legal): challenger draws six and loses their turn", () => {
    const { g, state } = afterPlay(false);
    const res = run(state, cmd("CHALLENGE_WILD_DRAW_FOUR", "b"));
    expect(handOf(res.state, "b")).toHaveLength(9);
    expect(handOf(res.state, "b").slice(3)).toEqual(DRAW.slice(0, 6).map((s) => g.id(s)));
    expect(handOf(res.state, "a")).toHaveLength(2);
    expect(currentId(res.state)).toBe("c");
    expect(types(res.events)).toEqual(["CHALLENGE_RESOLVED", "CARDS_DRAWN", "TURN_CHANGED"]);
    expect(find(res.events, "CHALLENGE_RESOLVED").success).toBe(false);
    expect(find(res.events, "CARDS_DRAWN")).toMatchObject({
      playerId: "b",
      count: 6,
      reason: "challenge_failed",
    });
    expectConserved(res.state);
  });
  it("only the target may challenge", () => {
    const { state } = afterPlay(true);
    expectRejected(state, cmd("CHALLENGE_WILD_DRAW_FOUR", "c"), "NOT_CHALLENGE_TARGET");
    expectRejected(state, cmd("CHALLENGE_WILD_DRAW_FOUR", "a"), "NOT_CHALLENGE_TARGET");
  });
  it("cannot challenge when nothing is pending", () => {
    const g = game(true);
    expectRejected(g.state, cmd("CHALLENGE_WILD_DRAW_FOUR", "b"), "NO_CHALLENGE_PENDING");
  });
  it("cannot challenge after having already resolved it", () => {
    const { state } = afterPlay(true);
    const done = run(state, cmd("CHALLENGE_WILD_DRAW_FOUR", "b")).state;
    expectRejected(done, cmd("CHALLENGE_WILD_DRAW_FOUR", "b"), "NO_CHALLENGE_PENDING");
  });
  it("cannot challenge after drawing", () => {
    const { state } = afterPlay(true);
    const done = run(state, cmd("DRAW_CARD", "b")).state;
    expectRejected(done, cmd("CHALLENGE_WILD_DRAW_FOUR", "b"), "NO_CHALLENGE_PENDING");
  });
  it("judges the colour at the time of play, not later", () => {
    const { state } = afterPlay(true);
    expect(state.pendingChallenge?.previousColor).toBe("red");
    expect(state.activeColor).toBe("green");
  });
  it("a successful challenge leaves the turn with the challenger, who can then draw or play", () => {
    const { state } = afterPlay(true);
    const done = run(state, cmd("CHALLENGE_WILD_DRAW_FOUR", "b")).state;
    expect(getLegalMoves(done, "b").some((m) => m.type === "DRAW_CARD")).toBe(true);
  });
  it("draws six from a reshuffled pile when the pile is short", () => {
    const { state } = afterPlay(false, { fillerTo: "discard", draw: ["yellow-1", "yellow-2"] });
    const res = run(state, cmd("CHALLENGE_WILD_DRAW_FOUR", "b"));
    expect(handOf(res.state, "b")).toHaveLength(9);
    expect(types(res.events)).toContain("DRAW_PILE_RESHUFFLED");
    expectConserved(res.state);
  });
});

describe("strict Wild Draw Four", () => {
  const strict = (hand: string[]) =>
    setup({
      hands: { a: hand, b: ["blue-1", "blue-2"], c: ["green-2", "green-3"] },
      top: "red-5",
      config: { strictWildDrawFour: true },
    });
  it("rejects the play while holding the active colour", () => {
    const g = strict(["wd4", "red-7", "green-1"]);
    expectRejected(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("wd4"), color: "green" }),
      "WILD_DRAW_FOUR_ILLEGAL",
    );
  });
  it("allows it without the active colour", () => {
    const g = strict(["wd4", "blue-5", "green-1"]);
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wd4"), color: "green" }));
    expect(state.phase).toBe("awaiting_challenge");
  });
  it("does not list the card as legal while illegal", () => {
    const g = strict(["wd4", "red-7", "green-1"]);
    const moves = getLegalMoves(g.state, "a");
    expect(moves.some((m) => m.type === "PLAY_CARD" && m.cardId === g.id("wd4"))).toBe(false);
  });
});

describe("Wild Draw Four as the last card", () => {
  it("wins immediately: the victim draws four, no challenge is offered", () => {
    const g = setup({
      hands: { a: ["wd4"], b: ["red-1", "red-2", "red-3"], c: ["blue-1", "blue-2", "blue-3"] },
      top: "red-5",
      draw: ["yellow-1", "yellow-2", "yellow-3", "yellow-4"],
    });
    const { state, events } = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("wd4"), color: "green" }),
    );
    expect(types(events)).toEqual([
      "CARD_PLAYED",
      "COLOR_CHOSEN",
      "CARDS_DRAWN",
      "HAND_WON",
      "MATCH_ENDED",
    ]);
    expect(find(events, "HAND_WON")).toMatchObject({ winnerId: "a", points: 6 + 6 + 10 });
    expect(state.pendingChallenge).toBeNull();
    expect(state.phase).toBe("match_over");
    expect(handOf(state, "b")).toHaveLength(7);
  });
});
