import { describe, expect, it } from "vitest";
import { getLegalMoves } from "./rules";
import { filterEventsForViewer, getPlayerView, getPublicView } from "./views";
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
  started,
  types,
} from "./test-helpers";

const roulette = (draw: string[], extra: Partial<Parameters<typeof setup>[0]> = {}) =>
  setup({
    variant: "no_mercy",
    hands: {
      a: ["roulette", "green-1", "green-2"],
      b: ["blue-1", "blue-2"],
      c: ["yellow-1", "yellow-2"],
    },
    top: "red-5",
    draw,
    ...extra,
  });
const played = (draw: string[], extra: Partial<Parameters<typeof setup>[0]> = {}) => {
  const g = roulette(draw, extra);
  return { g, ...run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("roulette") })) };
};

describe("Wild Color Roulette", () => {
  it("starts a roulette: the next player must name a colour", () => {
    const { state, events } = played(["green-3"]);
    expect(state.phase).toBe("awaiting_roulette_color");
    expect(state.colorRouletteActive).toEqual({ playedById: "a", targetId: "b" });
    expect(currentId(state)).toBe("b");
    expect(state.activeColor).toBe("red");
    expect(types(events)).toEqual(["CARD_PLAYED", "ROULETTE_STARTED", "TURN_CHANGED"]);
    expect(find(events, "ROULETTE_STARTED")).toEqual({
      type: "ROULETTE_STARTED",
      playerId: "a",
      targetId: "b",
    });
  });
  it("the player who plays it does not choose a colour", () => {
    const g = roulette(["green-3"]);
    const { events } = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("roulette"), color: "blue" }),
    );
    expect(find(events, "CARD_PLAYED").chosenColor).toBeNull();
  });
  it("the target names a colour, then reveals cards until one matches, keeping them all", () => {
    const { g, state } = played(["green-3", "wd6", "green-4", "blue-5", "blue-6"]);
    const res = run(state, cmd("CHOOSE_COLOR", "b", { color: "blue" }));
    expect(types(res.events)).toEqual([
      "COLOR_CHOSEN",
      "CARDS_DRAWN",
      "CARDS_DRAWN",
      "CARDS_DRAWN",
      "CARDS_DRAWN",
      "TURN_CHANGED",
    ]);
    const drawn = res.events.flatMap((e) => (e.type === "CARDS_DRAWN" ? [e] : []));
    expect(drawn.map((e) => e.cardIds)).toEqual(
      ["green-3", "wd6", "green-4", "blue-5"].map((s) => [g.id(s)]),
    );
    expect(drawn.every((e) => e.reason === "color_roulette" && e.count === 1)).toBe(true);
    expect(handOf(res.state, "b")).toHaveLength(6);
    expect(res.state.activeColor).toBe("blue");
    expect(res.state.colorRouletteActive).toBeNull();
    expect(currentId(res.state)).toBe("c");
    expect(res.state.drawPile.at(-1)).toBe(g.id("blue-6"));
    expectConserved(res.state);
  });
  it("stops after one card when the first card already matches", () => {
    const { state } = played(["blue-5", "blue-6"]);
    const res = run(state, cmd("CHOOSE_COLOR", "b", { color: "blue" }));
    expect(res.events.filter((e) => e.type === "CARDS_DRAWN")).toHaveLength(1);
    expect(handOf(res.state, "b")).toHaveLength(3);
  });
  it("Wilds never count as a match, whatever colour was named", () => {
    const { g, state } = played(["wd10", "roulette#2", "yellow-9"]);
    const res = run(state, cmd("CHOOSE_COLOR", "b", { color: "yellow" }));
    expect(res.events.filter((e) => e.type === "CARDS_DRAWN")).toHaveLength(3);
    expect(handOf(res.state, "b").slice(2)).toEqual([
      g.id("wd10"),
      g.id("roulette#2"),
      g.id("yellow-9"),
    ]);
  });
  it("the target then loses their turn", () => {
    const { state } = played(["blue-5"]);
    expect(currentId(run(state, cmd("CHOOSE_COLOR", "b", { color: "blue" })).state)).toBe("c");
  });
  it("stops when the pile runs out and the turn passes", () => {
    const g = roulette(["green-3", "green-4"]);
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("roulette") })).state;
    s1.drawPile = [g.id("green-3"), g.id("green-4")].reverse().reverse();
    s1.discardPile = [s1.discardPile.at(-1) as string];
    const res = run(s1, cmd("CHOOSE_COLOR", "b", { color: "blue" }));
    expect(types(res.events)).toEqual([
      "COLOR_CHOSEN",
      "CARDS_DRAWN",
      "CARDS_DRAWN",
      "TURN_CHANGED",
    ]);
    expect(handOf(res.state, "b")).toHaveLength(4);
  });
  it("eliminates the target mid-reveal at 25 cards and ends the reveal", () => {
    const pool = junk(26);
    const g = setup({
      variant: "no_mercy",
      hands: { a: ["roulette", "red-1"], b: pool.slice(0, 23), c: ["red-2", "red-3"] },
      top: "red-5",
      draw: pool.slice(23),
    });
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("roulette") })).state;
    const res = run(s1, cmd("CHOOSE_COLOR", "b", { color: "red" }));
    expect(types(res.events)).toEqual([
      "COLOR_CHOSEN",
      "CARDS_DRAWN",
      "CARDS_DRAWN",
      "PLAYER_ELIMINATED",
      "TURN_CHANGED",
    ]);
    expect(res.state.eliminatedPlayerIds).toEqual(["b"]);
    expect(res.state.colorRouletteActive).toBeNull();
    expect(currentId(res.state)).toBe("c");
    expectConserved(res.state);
  });
  it("only the target may choose, and only a real colour", () => {
    const { state } = played(["blue-5"]);
    expectRejected(state, cmd("CHOOSE_COLOR", "a", { color: "blue" }), "NOT_YOUR_TURN");
    expectRejected(state, cmd("CHOOSE_COLOR", "c", { color: "blue" }), "NOT_YOUR_TURN");
    expectRejected(state, cmd("CHOOSE_COLOR", "b", { color: "pink" }), "COLOR_INVALID");
  });
  it("nothing else can happen while the colour is pending", () => {
    const { g, state } = played(["blue-5"]);
    expectRejected(
      state,
      cmd("PLAY_CARD", "b", { cardId: g.id("blue-1") }),
      "COLOR_CHOICE_PENDING",
    );
    expectRejected(state, cmd("DRAW_CARD", "b"), "COLOR_CHOICE_PENDING");
    expectRejected(state, cmd("PASS_TURN", "b"), "COLOR_CHOICE_PENDING");
  });
  it("offers the target exactly four colours", () => {
    const { state } = played(["blue-5"]);
    expect(getLegalMoves(state, "b").filter((m) => m.type === "CHOOSE_COLOR")).toHaveLength(4);
    expect(getLegalMoves(state, "c").map((m) => m.type)).toEqual(["RESIGN", "REQUEST_SNAPSHOT"]);
  });
  it("cannot be played on a pending stack", () => {
    const g = setup({
      variant: "no_mercy",
      hands: {
        a: ["red-draw_two", "green-1", "green-2"],
        b: ["roulette", "blue-1"],
        c: ["yellow-1", "yellow-2"],
      },
      top: "red-5",
    });
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    expectRejected(
      faced,
      cmd("PLAY_CARD", "b", { cardId: g.id("roulette") }),
      "MUST_STACK_OR_DRAW",
    );
  });
  it("as the last card it simply wins", () => {
    const g = setup({
      variant: "no_mercy",
      hands: { a: ["roulette"], b: ["blue-1", "blue-2"], c: ["yellow-1", "yellow-2"] },
      top: "red-5",
    });
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("roulette") }));
    expect(types(events)).toEqual(["CARD_PLAYED", "HAND_WON", "MATCH_ENDED"]);
    expect(state.colorRouletteActive).toBeNull();
  });
  it("the revealed cards are public to the whole table", () => {
    const { g, state } = played(["green-3", "blue-5"]);
    const res = run(state, cmd("CHOOSE_COLOR", "b", { color: "blue" }));
    const seenByC = filterEventsForViewer(res.events, "c").filter((e) => e.type === "CARDS_DRAWN");
    expect(seenByC.map((e) => (e as { cardIds?: string[] }).cardIds)).toEqual([
      [g.id("green-3")],
      [g.id("blue-5")],
    ]);
  });
  it("shows who the roulette target is in the public view", () => {
    const { state } = played(["blue-5"]);
    expect(getPublicView(state).rouletteTargetId).toBe("b");
    expect(getPublicView(state).phase).toBe("awaiting_roulette_color");
  });
  it("any Wild may be played on a roulette, with the chosen colour in force", () => {
    const g = roulette(["blue-5"], {
      hands: {
        a: ["roulette", "green-1", "green-2"],
        b: ["blue-1", "blue-2"],
        c: ["wd6", "yellow-2"],
      },
    });
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("roulette") })).state;
    const s2 = run(s1, cmd("CHOOSE_COLOR", "b", { color: "blue" })).state;
    expect(currentId(s2)).toBe("c");
    expect(
      types(run(s2, cmd("PLAY_CARD", "c", { cardId: g.id("wd6"), color: "green" })).events),
    ).toContain("PENALTY_PENDING");
  });
});

describe("elimination at the mercy limit", () => {
  const facing = (
    hand: string[],
    total: number,
    extra: Partial<Parameters<typeof setup>[0]> = {},
  ) =>
    setup({
      variant: "no_mercy",
      hands: { a: ["red-6", "red-7"], b: hand, c: ["red-8", "red-9"] },
      top: "red-5",
      draw: ["red-1", "red-2", "red-3", "red-4"],
      current: "b",
      penalty: { total, topValue: total },
      ...extra,
    });
  it("exactly 25 cards eliminates", () => {
    const g = facing(junk(23), 2);
    const { state, events } = run(g.state, cmd("DRAW_CARD", "b"));
    expect(find(events, "CARDS_DRAWN")).toMatchObject({ count: 2 });
    expect(find(events, "PLAYER_ELIMINATED")).toEqual({
      type: "PLAYER_ELIMINATED",
      playerId: "b",
      cardsReturned: 25,
    });
    expect(state.eliminatedPlayerIds).toEqual(["b"]);
  });
  it("24 cards survives", () => {
    const g = facing(junk(22), 2);
    const { state, events } = run(g.state, cmd("DRAW_CARD", "b"));
    expect(types(events)).not.toContain("PLAYER_ELIMINATED");
    expect(handOf(state, "b")).toHaveLength(24);
  });
  it("the threshold is configurable", () => {
    const g = facing(junk(11), 2, { config: { mercyThreshold: 12 } });
    const { state, events } = run(g.state, cmd("DRAW_CARD", "b"));
    expect(find(events, "PLAYER_ELIMINATED").cardsReturned).toBe(12);
    expect(state.eliminatedPlayerIds).toEqual(["b"]);
  });
  it("shuffles the eliminated hand back into the draw pile", () => {
    const g = facing(junk(24), 4);
    const before = g.state.drawPile.length;
    const hand = [...handOf(g.state, "b")];
    const { state } = run(g.state, cmd("DRAW_CARD", "b"));
    expect(handOf(state, "b")).toEqual([]);
    expect(state.drawPile.length).toBe(before - 1 + 25);
    for (const id of hand) expect(state.drawPile).toContain(id);
    expect(state.rngState).not.toEqual(g.state.rngState);
    expectConserved(state);
  });
  it("marks the player eliminated in the public view", () => {
    const g = facing(junk(24), 4);
    const { state } = run(g.state, cmd("DRAW_CARD", "b"));
    const view = getPublicView(state);
    expect(view.eliminatedPlayerIds).toEqual(["b"]);
    expect(view.players.find((p) => p.id === "b")).toMatchObject({
      eliminated: true,
      handCount: 0,
    });
  });
  it("eliminated players are skipped in the turn order", () => {
    const g = setup({
      variant: "no_mercy",
      hands: { a: ["red-6", "red-7", "red-8"], b: [], c: ["red-1", "red-2"] },
      top: "red-5",
      eliminated: ["b"],
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-6") }));
    expect(currentId(state)).toBe("c");
  });
  it("a stack skips an eliminated player to reach the next one", () => {
    const g = setup({
      variant: "no_mercy",
      hands: { a: ["red-draw_two", "red-7", "red-8"], b: [], c: ["red-1", "red-2"] },
      top: "red-5",
      eliminated: ["b"],
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") }));
    expect(currentId(state)).toBe("c");
    expect(state.phase).toBe("facing_penalty");
  });
  it("eliminated players cannot act, but may ask for a snapshot", () => {
    const g = setup({
      variant: "no_mercy",
      hands: { a: ["red-6", "red-7"], b: [], c: ["red-1", "red-2"] },
      top: "red-5",
      eliminated: ["b"],
    });
    expectRejected(g.state, cmd("DRAW_CARD", "b"), "PLAYER_ELIMINATED");
    expectRejected(g.state, cmd("RESIGN", "b"), "PLAYER_ELIMINATED");
    expect(getLegalMoves(g.state, "b")).toEqual([{ type: "REQUEST_SNAPSHOT" }]);
    expect(run(g.state, cmd("REQUEST_SNAPSHOT", "b")).events).toEqual([
      { type: "SNAPSHOT_REQUESTED", playerId: "b" },
    ]);
  });
  it("the game continues as a two-player loop after one of three is eliminated", () => {
    const g = facing(junk(24), 4);
    const s1 = run(g.state, cmd("DRAW_CARD", "b")).state;
    expect(currentId(s1)).toBe("c");
    const s2 = run(s1, cmd("PLAY_CARD", "c", { cardId: g.id("red-8") })).state;
    expect(currentId(s2)).toBe("a");
    const s3 = run(s2, cmd("PLAY_CARD", "a", { cardId: g.id("red-6") })).state;
    expect(currentId(s3)).toBe("c");
  });
  it("the last player standing wins the hand and the match", () => {
    const g = setup({
      variant: "no_mercy",
      hands: { a: ["red-1", "red-2"], b: junk(24) },
      top: "red-5",
      draw: ["red-3", "red-4"],
      current: "b",
      penalty: { total: 2, topValue: 2 },
    });
    const { state, events } = run(g.state, cmd("DRAW_CARD", "b"));
    expect(types(events)).toEqual(["CARDS_DRAWN", "PLAYER_ELIMINATED", "HAND_WON", "MATCH_ENDED"]);
    expect(find(events, "HAND_WON")).toMatchObject({ winnerId: "a", points: 250 });
    expect(find(events, "MATCH_ENDED").summary).toMatchObject({
      winnerId: "a",
      endReason: "last_standing",
    });
    expect(state.phase).toBe("match_over");
    expect(state.pendingPenalty).toBeNull();
  });
  it("awards 250 for each knockout to the hand's winner, on top of the cards in hand", () => {
    const g = setup({
      variant: "no_mercy",
      hands: { a: ["red-6"], b: [], c: ["yellow-1", "yellow-2"] },
      top: "red-5",
      eliminated: ["b"],
    });
    const { events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-6") }));
    expect(find(events, "HAND_WON").points).toBe(3 + 250);
  });
  it("two knockouts are worth 500", () => {
    const g = setup({
      variant: "no_mercy",
      hands: { a: ["red-6"], b: [], c: [], d: ["yellow-1"] },
      top: "red-5",
      eliminated: ["b", "c"],
    });
    expect(
      find(run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-6") })).events, "HAND_WON")
        .points,
    ).toBe(1 + 500);
  });
  it("a new hand brings everyone back in", () => {
    const g = setup({
      variant: "no_mercy",
      hands: { a: ["red-1", "red-2"], b: junk(24) },
      top: "red-5",
      draw: ["red-3", "red-4"],
      current: "b",
      penalty: { total: 2, topValue: 2 },
      config: { targetScore: 1000 },
    });
    const over = run(g.state, cmd("DRAW_CARD", "b")).state;
    expect(over.phase).toBe("hand_over");
    expect(over.eliminatedPlayerIds).toEqual(["b"]);
    const { state } = run(over, cmd("START_HAND", "b"));
    expect(state.eliminatedPlayerIds).toEqual([]);
    expect(state.players.every((p) => p.hand.length === 7)).toBe(true);
    expect(state.players[0]?.score).toBe(250);
    expectConserved(state);
  });
  it("elimination clears the player's UNO window", () => {
    const g = facing(junk(24), 4, { unoWindow: { playerId: "b", openedAt: 0 } });
    expect(run(g.state, cmd("DRAW_CARD", "b")).state.unoWindow).toBeNull();
  });
  it("is part of the dealt hand setup: a fresh No Mercy hand starts with nobody out", () => {
    expect(started(2, ["a", "b", "c"], {}, "no_mercy").state.eliminatedPlayerIds).toEqual([]);
    expect(
      getPlayerView(started(2, ["a", "b", "c"], {}, "no_mercy").state, "a").eliminatedPlayerIds,
    ).toEqual([]);
  });
});
