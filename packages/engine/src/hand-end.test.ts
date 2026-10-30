import { describe, expect, it } from "vitest";
import { getLegalMoves } from "./rules";
import { getPublicView } from "./views";
import { cmd, expectRejected, find, handOf, run, setup, types } from "./test-helpers";

const finish = (
  hands: Record<string, string[]>,
  extra: Partial<Parameters<typeof setup>[0]> = {},
) =>
  setup({ hands, top: "red-5", draw: ["yellow-1", "yellow-2", "yellow-3", "yellow-4"], ...extra });

describe("winning a hand", () => {
  it("emptying the hand ends the hand and the match (single hand)", () => {
    const g = finish({ a: ["red-7"], b: ["blue-1", "blue-2"], c: ["green-3", "green-4"] });
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") }));
    expect(types(events)).toEqual(["CARD_PLAYED", "HAND_WON", "MATCH_ENDED"]);
    expect(state.phase).toBe("match_over");
    expect(state.handWinnerId).toBe("a");
    expect(state.matchWinnerId).toBe("a");
    expect(find(events, "HAND_WON")).toEqual({
      type: "HAND_WON",
      winnerId: "a",
      points: 10,
      scores: { a: 10, b: 0, c: 0 },
    });
    expect(handOf(state, "a")).toEqual([]);
  });
  it("scores the sum of all opponents' cards at face value", () => {
    const g = finish({ a: ["red-7"], b: ["blue-1", "blue-9"], c: ["green-3", "green-0"] });
    expect(
      find(run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") })).events, "HAND_WON")
        .points,
    ).toBe(13);
  });
  it("scores action cards 20 and wilds 50", () => {
    const g = finish({
      a: ["red-7"],
      b: ["blue-skip", "blue-reverse", "blue-draw_two"],
      c: ["wild", "wd4"],
    });
    expect(
      find(run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") })).events, "HAND_WON")
        .points,
    ).toBe(60 + 100);
  });
  it("builds a MatchSummary with placements", () => {
    const g = finish({ a: ["red-7"], b: ["blue-1"], c: ["green-5", "green-9"] });
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") }));
    const summary = find(events, "MATCH_ENDED").summary;
    expect(summary).toEqual(state.summary);
    expect(summary).toEqual({
      variant: "classic",
      winnerId: "a",
      endReason: "hand_empty",
      hands: [{ hand: 1, winnerId: "a", points: 15 }],
      players: [
        { id: "a", score: 15, placement: 1, resigned: false },
        { id: "b", score: 0, placement: 2, resigned: false },
        { id: "c", score: 0, placement: 3, resigned: false },
      ],
    });
  });
  it("the last card Draw Two still resolves: the victim draws before scoring", () => {
    const g = finish({ a: ["red-draw_two"], b: ["blue-1"], c: ["green-5"] });
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") }));
    expect(types(events)).toEqual(["CARD_PLAYED", "CARDS_DRAWN", "HAND_WON", "MATCH_ENDED"]);
    expect(handOf(state, "b")).toHaveLength(3);
    expect(find(events, "HAND_WON").points).toBe(1 + 1 + 2 + 5);
  });
  it("the last card Skip wins without advancing the turn", () => {
    const g = finish({ a: ["red-skip"], b: ["blue-1"], c: ["green-5"] });
    const { events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-skip") }));
    expect(types(events)).toEqual(["CARD_PLAYED", "HAND_WON", "MATCH_ENDED"]);
  });
  it("the last card Reverse wins", () => {
    const g = finish({ a: ["red-reverse"], b: ["blue-1"], c: ["green-5"] });
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-reverse") }));
    expect(types(events)).toContain("HAND_WON");
    expect(state.phase).toBe("match_over");
  });
  it("the last card Wild wins and still needs a colour", () => {
    const g = finish({ a: ["wild"], b: ["blue-1"], c: ["green-5"] });
    expectRejected(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wild") }), "COLOR_REQUIRED");
    const { events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wild"), color: "blue" }));
    expect(types(events)).toEqual(["CARD_PLAYED", "COLOR_CHOSEN", "HAND_WON", "MATCH_ENDED"]);
  });
  it("closes UNO windows when the hand ends", () => {
    const g = finish(
      { a: ["red-7"], b: ["blue-1"], c: ["green-5"] },
      { unoWindow: { playerId: "b", openedAt: 0 } },
    );
    expect(
      run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") })).state.unoWindow,
    ).toBeNull();
  });
});

describe("after the match", () => {
  const won = () => {
    const g = finish({ a: ["red-7"], b: ["blue-1", "blue-2"], c: ["green-3", "green-4"] });
    return { g, state: run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") })).state };
  };
  it("rejects plays with MATCH_OVER", () => {
    const { g, state } = won();
    expectRejected(state, cmd("PLAY_CARD", "b", { cardId: g.id("blue-1") }), "MATCH_OVER");
    expectRejected(state, cmd("DRAW_CARD", "b"), "MATCH_OVER");
    expectRejected(state, cmd("PASS_TURN", "b"), "MATCH_OVER");
    expectRejected(state, cmd("START_HAND", "b"), "MATCH_OVER");
  });
  it("offers only rematch and snapshot", () => {
    const { state } = won();
    expect(getLegalMoves(state, "b").map((m) => m.type)).toEqual([
      "VOTE_REMATCH",
      "REQUEST_SNAPSHOT",
    ]);
  });
  it("exposes the winner publicly", () => {
    const { state } = won();
    const view = getPublicView(state);
    expect(view.matchWinnerId).toBe("a");
    expect(view.currentPlayerId).toBeNull();
    expect(view.summary?.winnerId).toBe("a");
  });
});

describe("multi-hand matches (targetScore)", () => {
  const cfg = { targetScore: 500 };
  it("continues to the next hand when nobody has reached the target", () => {
    const g = finish(
      { a: ["red-7"], b: ["blue-1", "blue-2"], c: ["green-3", "green-4"] },
      { config: cfg },
    );
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") }));
    expect(types(events)).toEqual(["CARD_PLAYED", "HAND_WON"]);
    expect(state.phase).toBe("hand_over");
    expect(state.players[0]?.score).toBe(10);
    expect(state.matchWinnerId).toBeNull();
    expect(getLegalMoves(state, "b").map((m) => m.type)).toContain("START_HAND");
  });
  it("START_HAND begins hand two with scores kept and the dealer rotated", () => {
    const g = finish(
      { a: ["red-7"], b: ["blue-1", "blue-2"], c: ["green-3", "green-4"] },
      { config: cfg },
    );
    const over = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") })).state;
    const { state, events } = run(over, cmd("START_HAND", "b"));
    expect(find(events, "HAND_STARTED")).toMatchObject({ handNumber: 2, dealerId: "a" });
    expect(state.players[0]?.score).toBe(10);
    expect(state.players.every((p) => p.hand.length === 7 || p.hand.length === 9)).toBe(true);
    expect(state.handResults).toHaveLength(1);
  });
  it("ends the match when a player reaches the target", () => {
    const g = finish(
      { a: ["red-7"], b: ["blue-1", "blue-2"], c: ["green-3", "green-4"] },
      { config: cfg, scores: { a: 495 } },
    );
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") }));
    expect(types(events)).toEqual(["CARD_PLAYED", "HAND_WON", "MATCH_ENDED"]);
    expect(find(events, "MATCH_ENDED").summary.endReason).toBe("points_target");
    expect(state.players[0]?.score).toBe(505);
  });
  it("rejects plays while between hands", () => {
    const g = finish(
      { a: ["red-7"], b: ["blue-1", "blue-2"], c: ["green-3", "green-4"] },
      { config: cfg },
    );
    const over = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") })).state;
    expectRejected(over, cmd("DRAW_CARD", "b"), "HAND_OVER");
    expectRejected(over, cmd("PLAY_CARD", "b", { cardId: g.id("blue-1") }), "HAND_OVER");
  });
});
