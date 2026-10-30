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

const nm = (hands: Record<string, string[]>, extra: Partial<Parameters<typeof setup>[0]> = {}) =>
  setup({ variant: "no_mercy", hands, top: "red-5", ...extra });

describe("Discard All", () => {
  const hand = ["red-discard_all", "red-1", "red-2", "blue-3", "green-4"];
  const play = () => {
    const g = nm({ a: hand, b: ["blue-1", "blue-2"], c: ["yellow-1", "yellow-2"] });
    return { g, ...run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-discard_all") })) };
  };
  it("discards every other card of its colour, underneath it", () => {
    const { g, state, events } = play();
    expect(handOf(state, "a")).toEqual([g.id("blue-3"), g.id("green-4")]);
    expect(state.discardPile.slice(-4)).toEqual([
      g.id("red-5"),
      g.id("red-1"),
      g.id("red-2"),
      g.id("red-discard_all"),
    ]);
    expect(types(events)).toEqual(["CARD_PLAYED", "CARDS_DISCARDED", "TURN_CHANGED"]);
    expect(find(events, "CARDS_DISCARDED")).toEqual({
      type: "CARDS_DISCARDED",
      playerId: "a",
      cardIds: [g.id("red-1"), g.id("red-2")],
    });
    expectConserved(state);
  });
  it("leaves the Discard All on top, with its colour active", () => {
    const { g, state } = play();
    expect(state.discardPile.at(-1)).toBe(g.id("red-discard_all"));
    expect(state.activeColor).toBe("red");
    expect(currentId(state)).toBe("b");
  });
  it("with no other card of the colour only the Discard All goes", () => {
    const g = nm({
      a: ["red-discard_all", "blue-3", "green-4"],
      b: ["blue-1", "blue-2"],
      c: ["yellow-1", "yellow-2"],
    });
    const { state, events } = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("red-discard_all") }),
    );
    expect(types(events)).toEqual(["CARD_PLAYED", "TURN_CHANGED"]);
    expect(handOf(state, "a")).toHaveLength(2);
  });
  it("is playable on another Discard All by symbol, switching to its colour", () => {
    const g = setup({
      variant: "no_mercy",
      hands: {
        a: ["blue-discard_all", "blue-1", "blue-3", "red-2"],
        b: ["green-1", "green-2"],
        c: ["yellow-1", "yellow-2"],
      },
      top: "red-discard_all",
    });
    const { state, events } = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("blue-discard_all") }),
    );
    expect(state.activeColor).toBe("blue");
    expect(find(events, "CARDS_DISCARDED").cardIds).toEqual([g.id("blue-1"), g.id("blue-3")]);
    expect(handOf(state, "a")).toEqual([g.id("red-2")]);
  });
  it("leaves Wilds alone", () => {
    const g = nm({
      a: ["red-discard_all", "wd6", "roulette", "red-1"],
      b: ["blue-1", "blue-2"],
      c: ["yellow-1", "yellow-2"],
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-discard_all") }));
    expect(handOf(state, "a")).toEqual([g.id("wd6"), g.id("roulette")]);
  });
  it("takes a second Discard All of the same colour with it", () => {
    const g = nm({
      a: ["red-discard_all", "red-discard_all#2", "red-1", "blue-3"],
      b: ["blue-1", "blue-2"],
      c: ["yellow-1", "yellow-2"],
    });
    const { state, events } = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("red-discard_all") }),
    );
    expect(find(events, "CARDS_DISCARDED").cardIds).toEqual([
      g.id("red-discard_all#2"),
      g.id("red-1"),
    ]);
    expect(handOf(state, "a")).toEqual([g.id("blue-3")]);
  });
  it("emptying the hand wins the hand", () => {
    const g = nm({
      a: ["red-discard_all", "red-1", "red-2"],
      b: ["blue-1", "blue-2"],
      c: ["yellow-1", "yellow-2"],
    });
    const { state, events } = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("red-discard_all") }),
    );
    expect(types(events)).toEqual(["CARD_PLAYED", "CARDS_DISCARDED", "HAND_WON", "MATCH_ENDED"]);
    expect(find(events, "HAND_WON")).toMatchObject({ winnerId: "a", points: 3 + 3 });
    expect(state.phase).toBe("match_over");
  });
  it("leaving one card opens a UNO window", () => {
    const g = nm({
      a: ["red-discard_all", "red-1", "blue-3"],
      b: ["blue-1", "blue-2"],
      c: ["yellow-1", "yellow-2"],
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-discard_all") }, 777));
    expect(state.unoWindow).toEqual({ playerId: "a", openedAt: 777 });
  });
  it("cannot answer a pending penalty", () => {
    const g = nm({
      a: ["red-draw_two", "red-1", "red-2"],
      b: ["blue-discard_all", "blue-1"],
      c: ["yellow-1", "yellow-2"],
    });
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    expectRejected(
      faced,
      cmd("PLAY_CARD", "b", { cardId: g.id("blue-discard_all") }),
      "MUST_STACK_OR_DRAW",
    );
  });
});

describe("Skip Everyone", () => {
  it("skips all the other players and the same player goes again", () => {
    const g = nm({
      a: ["red-skip_everyone", "red-1", "red-2"],
      b: ["blue-1", "blue-2"],
      c: ["yellow-1", "yellow-2"],
    });
    const { state, events } = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("red-skip_everyone") }),
    );
    expect(currentId(state)).toBe("a");
    expect(state.phase).toBe("awaiting_play_or_draw");
    expect(types(events)).toEqual([
      "CARD_PLAYED",
      "PLAYER_SKIPPED",
      "PLAYER_SKIPPED",
      "TURN_CHANGED",
    ]);
    const skipped = events.flatMap((e) => (e.type === "PLAYER_SKIPPED" ? [e] : []));
    expect(skipped).toEqual([
      { type: "PLAYER_SKIPPED", playerId: "b", reason: "skip_everyone" },
      { type: "PLAYER_SKIPPED", playerId: "c", reason: "skip_everyone" },
    ]);
    expect(find(events, "TURN_CHANGED").playerId).toBe("a");
  });
  it("with two players it just skips the opponent", () => {
    const g = nm({ a: ["red-skip_everyone", "red-1", "red-2"], b: ["blue-1", "blue-2"] });
    const { state, events } = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("red-skip_everyone") }),
    );
    expect(currentId(state)).toBe("a");
    expect(events.filter((e) => e.type === "PLAYER_SKIPPED")).toHaveLength(1);
  });
  it("skips every opponent at a four-player table", () => {
    const g = nm({
      a: ["red-skip_everyone", "red-1", "red-2"],
      b: ["blue-1", "blue-2"],
      c: ["yellow-1", "yellow-2"],
      d: ["green-1", "green-2"],
    });
    const { events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-skip_everyone") }));
    expect(
      events
        .filter((e) => e.type === "PLAYER_SKIPPED")
        .map((e) => (e as { playerId: string }).playerId),
    ).toEqual(["b", "c", "d"]);
  });
  it("lists the skipped players in turn order for the current direction", () => {
    const g = nm(
      {
        a: ["red-skip_everyone", "red-1", "red-2"],
        b: ["blue-1", "blue-2"],
        c: ["yellow-1", "yellow-2"],
      },
      { direction: -1 },
    );
    const { events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-skip_everyone") }));
    expect(
      events
        .filter((e) => e.type === "PLAYER_SKIPPED")
        .map((e) => (e as { playerId: string }).playerId),
    ).toEqual(["c", "b"]);
  });
  it("does not skip eliminated players", () => {
    const g = nm(
      {
        a: ["red-skip_everyone", "red-1", "red-2"],
        b: [],
        c: ["yellow-1", "yellow-2"],
        d: ["green-1", "green-2"],
      },
      { eliminated: ["b"] },
    );
    const { events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-skip_everyone") }));
    expect(
      events
        .filter((e) => e.type === "PLAYER_SKIPPED")
        .map((e) => (e as { playerId: string }).playerId),
    ).toEqual(["c", "d"]);
  });
  it("matches another Skip Everyone by symbol", () => {
    const g = setup({
      variant: "no_mercy",
      hands: {
        a: ["red-skip_everyone", "red-1", "red-2"],
        b: ["blue-1", "blue-2"],
        c: ["yellow-1", "yellow-2"],
      },
      top: "blue-skip_everyone",
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-skip_everyone") }));
    expect(state.activeColor).toBe("red");
  });
  it("leaves the other hands untouched and lets the player play again", () => {
    const g = nm({
      a: ["red-skip_everyone", "red-1", "red-2"],
      b: ["blue-1", "blue-2"],
      c: ["yellow-1", "yellow-2"],
    });
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-skip_everyone") })).state;
    expect(handOf(s1, "b")).toHaveLength(2);
    const { state } = run(s1, cmd("PLAY_CARD", "a", { cardId: g.id("red-1") }));
    expect(currentId(state)).toBe("b");
  });
  it("as the last card wins immediately", () => {
    const g = nm({
      a: ["red-skip_everyone"],
      b: ["blue-1", "blue-2"],
      c: ["yellow-1", "yellow-2"],
    });
    const { events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-skip_everyone") }));
    expect(types(events)).toEqual(["CARD_PLAYED", "HAND_WON", "MATCH_ENDED"]);
  });
  it("cannot answer a pending penalty", () => {
    const g = nm({
      a: ["red-draw_two", "red-1", "red-2"],
      b: ["blue-skip_everyone", "blue-1"],
      c: ["yellow-1", "yellow-2"],
    });
    const faced = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") })).state;
    expectRejected(
      faced,
      cmd("PLAY_CARD", "b", { cardId: g.id("blue-skip_everyone") }),
      "MUST_STACK_OR_DRAW",
    );
  });
});
