import { describe, expect, it } from "vitest";
import { getLegalMoves } from "./rules";
import {
  cmd,
  currentId,
  expectConserved,
  expectRejected,
  find,
  findSeed,
  handOf,
  run,
  setup,
  started,
  types,
} from "./test-helpers";
import { cardDefOf } from "./cards";

const table = (extra: Partial<Parameters<typeof setup>[0]> = {}) =>
  setup({
    hands: {
      a: ["red-7", "blue-5", "green-1"],
      b: ["red-1", "red-2", "red-3"],
      c: ["blue-1", "blue-2", "blue-3"],
    },
    top: "red-5",
    draw: ["yellow-1", "yellow-2", "yellow-3"],
    ...extra,
  });

describe("resigning", () => {
  it("the current player resigns: hand goes to the bottom of the pile and the turn moves on", () => {
    const g = table();
    const { state, events } = run(g.state, cmd("RESIGN", "a"));
    expect(state.players[0]?.resigned).toBe(true);
    expect(handOf(state, "a")).toEqual([]);
    expect(state.drawPile.slice(0, 3)).toEqual([g.id("red-7"), g.id("blue-5"), g.id("green-1")]);
    expect(currentId(state)).toBe("b");
    expect(types(events)).toEqual(["PLAYER_RESIGNED", "TURN_CHANGED"]);
    expect(events[0]).toEqual({ type: "PLAYER_RESIGNED", playerId: "a", cardsReturned: 3 });
    expectConserved(state);
  });
  it("another player resigning leaves the turn alone", () => {
    const { state, events } = run(table().state, cmd("RESIGN", "c"));
    expect(currentId(state)).toBe("a");
    expect(types(events)).toEqual(["PLAYER_RESIGNED"]);
  });
  it("a resigned player is skipped in the turn order", () => {
    const g = table();
    const s1 = run(g.state, cmd("RESIGN", "b")).state;
    const { state } = run(s1, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") }));
    expect(currentId(state)).toBe("c");
  });
  it("a resigned player's commands are rejected", () => {
    const s1 = run(table().state, cmd("RESIGN", "c")).state;
    expectRejected(s1, cmd("DRAW_CARD", "c"), "PLAYER_RESIGNED");
    expectRejected(s1, cmd("RESIGN", "c"), "PLAYER_RESIGNED");
  });
  it("a resigned player has no legal moves", () => {
    const s1 = run(table().state, cmd("RESIGN", "c")).state;
    expect(getLegalMoves(s1, "c")).toEqual([]);
  });
  it("two players: the opponent wins by forfeit", () => {
    const g = setup({ hands: { a: ["red-7", "red-8"], b: ["red-1", "red-2"] }, top: "red-5" });
    const { state, events } = run(g.state, cmd("RESIGN", "b"));
    expect(types(events)).toEqual(["PLAYER_RESIGNED", "MATCH_ENDED"]);
    expect(find(events, "MATCH_ENDED").summary).toMatchObject({
      winnerId: "a",
      endReason: "forfeit",
    });
    expect(state.phase).toBe("match_over");
    expect(state.matchWinnerId).toBe("a");
  });
  it("three players: the last one standing wins", () => {
    const s1 = run(table().state, cmd("RESIGN", "b")).state;
    const { state, events } = run(s1, cmd("RESIGN", "c"));
    expect(find(events, "MATCH_ENDED").summary.winnerId).toBe("a");
    expect(state.phase).toBe("match_over");
    expect(find(events, "MATCH_ENDED").summary.players.map((p) => p.resigned)).toEqual([
      false,
      true,
      true,
    ]);
  });
  it("the challenge target resigning voids the challenge and moves on", () => {
    const g = setup({
      hands: { a: ["red-7", "green-1"], b: ["blue-1", "blue-2"], c: ["blue-3", "blue-4"] },
      top: "wd4",
      color: "green",
      pending: { playedBy: "a", target: "b", prev: "red", matching: true },
    });
    const { state } = run(g.state, cmd("RESIGN", "b"));
    expect(state.pendingChallenge).toBeNull();
    expect(state.phase).toBe("awaiting_play_or_draw");
    expect(currentId(state)).toBe("c");
  });
  it("the Wild Draw Four player resigning voids the challenge; the target plays normally", () => {
    const g = setup({
      hands: { a: ["red-7", "green-1"], b: ["blue-1", "blue-2"], c: ["blue-3", "blue-4"] },
      top: "wd4",
      color: "green",
      pending: { playedBy: "a", target: "b", prev: "red", matching: true },
    });
    const { state } = run(g.state, cmd("RESIGN", "a"));
    expect(state.pendingChallenge).toBeNull();
    expect(state.phase).toBe("awaiting_play_or_draw");
    expect(currentId(state)).toBe("b");
    expect(state.activeColor).toBe("green");
  });
  it("resigning while holding the drawn card clears it", () => {
    const g = setup({
      hands: { a: ["blue-5", "green-1"], b: ["blue-1", "blue-2"], c: ["blue-3", "blue-4"] },
      top: "red-5",
      draw: ["red-9"],
    });
    const drew = run(g.state, cmd("DRAW_CARD", "a")).state;
    const { state } = run(drew, cmd("RESIGN", "a"));
    expect(state.drawnCardId).toBeNull();
    expect(state.phase).toBe("awaiting_play_or_draw");
    expect(currentId(state)).toBe("b");
  });
  it("resigning clears the player's UNO window", () => {
    const g = table({ unoWindow: { playerId: "c", openedAt: 0 } });
    expect(run(g.state, cmd("RESIGN", "c")).state.unoWindow).toBeNull();
  });
  it("is rejected after the match ends", () => {
    const g = setup({ hands: { a: ["red-7"], b: ["red-1"] }, top: "red-5" });
    const over = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") })).state;
    expectRejected(over, cmd("RESIGN", "b"), "MATCH_OVER");
  });
  it("is allowed before a hand starts, and the hand is then dealt to the remaining players", () => {
    const { initial } = started(3);
    const s1 = run(initial, cmd("RESIGN", "c")).state;
    const { state } = run(s1, cmd("START_HAND", "a"));
    expect(state.players[2]?.hand).toEqual([]);
    expect(state.players[0]?.hand.length).toBeGreaterThanOrEqual(7);
    expect(state.drawPile.length + state.discardPile.length).toBe(108 - 14);
  });
  it("the first player resigning during the opening colour choice passes the choice on", () => {
    const seed = findSeed((s) => s.phase === "awaiting_opening_color");
    const r = started(seed);
    const { state, events } = run(r.state, cmd("RESIGN", "a"));
    expect(state.phase).toBe("awaiting_opening_color");
    expect(state.activeColor).toBeNull();
    expect(currentId(state)).toBe("b");
    expect(types(events)).toEqual(["PLAYER_RESIGNED", "TURN_CHANGED"]);
  });
});

describe("rematch", () => {
  const over = () => {
    const g = setup({
      hands: { a: ["red-7"], b: ["red-1", "red-2"], c: ["blue-1"] },
      top: "red-5",
    });
    return run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") })).state;
  };
  it("one vote is recorded and nothing else happens", () => {
    const { state, events } = run(over(), cmd("VOTE_REMATCH", "a"));
    expect(state.rematchVotes).toEqual(["a"]);
    expect(events).toEqual([{ type: "REMATCH_VOTED", playerId: "a" }]);
    expect(state.phase).toBe("match_over");
  });
  it("unanimous votes reset scores and return to pre_hand with the dealer rotated", () => {
    let s = over();
    s = run(s, cmd("VOTE_REMATCH", "a")).state;
    s = run(s, cmd("VOTE_REMATCH", "b")).state;
    const { state, events } = run(s, cmd("VOTE_REMATCH", "c"));
    expect(types(events)).toEqual(["REMATCH_VOTED", "REMATCH_AGREED"]);
    expect(state.phase).toBe("pre_hand");
    expect(state.players.every((p) => p.score === 0 && p.hand.length === 0)).toBe(true);
    expect(state.summary).toBeNull();
    expect(state.matchWinnerId).toBeNull();
    expect(state.rematchVotes).toEqual([]);
    expect(state.handNumber).toBe(0);
    expect(state.dealerSeat).toBe(0);
  });
  it("a new hand can start after the rematch", () => {
    let s = over();
    for (const p of ["a", "b", "c"]) s = run(s, cmd("VOTE_REMATCH", p)).state;
    const { state, events } = run(s, cmd("START_HAND", "b"));
    expect(find(events, "HAND_STARTED")).toMatchObject({
      handNumber: 1,
      dealerId: "a",
      firstPlayerId: "b",
    });
    expectConserved(state);
  });
  it("voting twice is rejected", () => {
    const s = run(over(), cmd("VOTE_REMATCH", "a")).state;
    expectRejected(s, cmd("VOTE_REMATCH", "a"), "ALREADY_VOTED");
  });
  it("voting before the match ends is rejected", () => {
    expectRejected(table().state, cmd("VOTE_REMATCH", "a"), "WRONG_PHASE");
  });
  it("players who resigned do not need to vote", () => {
    const g = setup({
      hands: { a: ["red-7"], b: ["red-1", "red-2"], c: ["blue-1"] },
      top: "red-5",
    });
    const s1 = run(g.state, cmd("RESIGN", "c")).state;
    const won = run(s1, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") })).state;
    const s2 = run(won, cmd("VOTE_REMATCH", "a")).state;
    const { events } = run(s2, cmd("VOTE_REMATCH", "b"));
    expect(types(events)).toContain("REMATCH_AGREED");
  });
});

describe("empty draw pile", () => {
  const nearlyEmpty = (extra: Partial<Parameters<typeof setup>[0]> = {}) =>
    setup({
      hands: { a: ["green-1", "green-2"], b: ["blue-1", "blue-2"], c: ["blue-3", "blue-4"] },
      top: "red-5",
      fillerTo: "discard",
      ...extra,
    });
  it("reshuffles the discard pile except the top card into the draw pile", () => {
    const g = nearlyEmpty();
    const topBefore = g.state.discardPile.at(-1);
    const { state, events } = run(g.state, cmd("DRAW_CARD", "a"));
    expect(types(events)[0]).toBe("DRAW_PILE_RESHUFFLED");
    expect(find(events, "DRAW_PILE_RESHUFFLED").cardCount).toBe(108 - 6 - 1);
    expect(state.discardPile).toEqual([topBefore]);
    expect(handOf(state, "a")).toHaveLength(3);
    expectConserved(state);
  });
  it("preserves the active colour set by a Wild on top", () => {
    const g = nearlyEmpty({ top: "wild", color: "blue" });
    const { state } = run(g.state, cmd("DRAW_CARD", "a"));
    expect(state.activeColor).toBe("blue");
    expect(cardDefOf(state.discardPile[0] as string).face).toBe("wild");
  });
  it("reshuffling is deterministic and advances the rng state", () => {
    const g = nearlyEmpty();
    const c = cmd("DRAW_CARD", "a");
    const one = run(g.state, c);
    const two = run(g.state, c);
    expect(JSON.stringify(one.state)).toBe(JSON.stringify(two.state));
    expect(one.state.rngState).not.toEqual(g.state.rngState);
  });
  it("gives what exists when both piles run dry mid-penalty", () => {
    const g = setup({
      hands: {
        a: ["red-draw_two", "red-1", "red-2"],
        b: ["blue-1", "blue-2"],
        c: ["blue-3", "blue-4"],
      },
      top: "red-5",
      draw: ["yellow-1"],
      fillerTo: "draw",
    });
    g.state.drawPile = [g.id("yellow-1")];
    g.state.discardPile = []; // the played Draw Two will be the only discard, so nothing can be reshuffled
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") }));
    const drawn = events.filter((e) => e.type === "CARDS_DRAWN");
    expect(drawn[0]).toMatchObject({ playerId: "b", count: 1 });
    expect(handOf(state, "b")).toHaveLength(3);
    expect(currentId(state)).toBe("c");
  });
  it("a draw with nothing left yields zero cards and passes the turn", () => {
    const g = nearlyEmpty();
    g.state.drawPile = [];
    g.state.discardPile = [g.state.discardPile.at(-1) as string];
    const { state, events } = run(g.state, cmd("DRAW_CARD", "a"));
    expect(find(events, "CARDS_DRAWN")).toMatchObject({ playerId: "a", count: 0 });
    expect(currentId(state)).toBe("b");
    expect(handOf(state, "a")).toHaveLength(2);
  });
});
