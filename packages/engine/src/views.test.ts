import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { filterEventsForViewer, getPlayerView, getPublicView } from "./snapshots";
import { cmd, find, handOf, run, setup, started } from "./test-helpers";
import { playRandomGame } from "./fuzz-helpers";

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      strings(v, out);
    }
  }
  return out;
}

const fixture = () =>
  setup({
    hands: {
      a: ["red-7", "blue-5", "green-1"],
      b: ["red-1", "red-2", "red-3"],
      c: ["blue-1", "blue-2", "blue-3"],
    },
    top: "red-5",
    draw: ["yellow-9", "yellow-8"],
  });

describe("public view", () => {
  it("shows counts, never cards, apart from the top of the discard pile", () => {
    const x = fixture();
    const v = getPublicView(x.state);
    expect(v.players.map((p) => [p.id, p.handCount])).toEqual([
      ["a", 3],
      ["b", 3],
      ["c", 3],
    ]);
    expect(v.topCardId).toBe(x.id("red-5"));
    expect(v.drawPileCount).toBe(x.state.drawPile.length);
    expect(v.currentPlayerId).toBe("a");
    expect(v.activeColor).toBe("red");
    expect(v.direction).toBe(1);
    const seen = strings(v);
    for (const p of x.state.players) for (const id of p.hand) expect(seen).not.toContain(id);
    for (const id of x.state.drawPile) expect(seen).not.toContain(id);
  });
  it("hides the challenge flag that would reveal a bluff", () => {
    const x = setup({
      hands: { a: ["red-7", "green-1"], b: ["blue-1", "blue-2"], c: ["blue-3", "blue-4"] },
      top: "wd4",
      color: "green",
      pending: { playedBy: "a", target: "b", prev: "red", matching: true },
    });
    const v = getPublicView(x.state);
    expect(v.pendingChallenge).toEqual({ playedById: "a", targetId: "b" });
    expect(JSON.stringify(v)).not.toContain("hadMatchingColor");
  });
  it("contains no internal state", () => {
    const text = JSON.stringify(getPublicView(fixture().state));
    for (const secret of ["rngState", "seenCommandIds", 'drawPile"', 'discardPile"', "handSeed"]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("player view", () => {
  it("includes the player's own hand and legal moves", () => {
    const x = fixture();
    const v = getPlayerView(x.state, "a");
    expect(v.selfId).toBe("a");
    expect(v.seat).toBe(0);
    expect(v.hand).toEqual(handOf(x.state, "a"));
    expect(v.playableCardIds).toEqual([x.id("red-7"), x.id("blue-5")]);
    expect(v.legalMoves.map((m) => m.type)).toContain("DRAW_CARD");
  });
  it("lists no gameplay moves for a player who is not on turn", () => {
    const v = getPlayerView(fixture().state, "b");
    expect(v.playableCardIds).toEqual([]);
    expect(v.legalMoves.map((m) => m.type)).toEqual(["RESIGN", "REQUEST_SNAPSHOT"]);
  });
  it("shows the drawn card only to the player who drew it", () => {
    const x = setup({
      hands: { a: ["blue-5", "green-1"], b: ["blue-1", "blue-2"], c: ["blue-3", "blue-4"] },
      top: "red-5",
      draw: ["red-9"],
    });
    const drew = run(x.state, cmd("DRAW_CARD", "a")).state;
    expect(getPlayerView(drew, "a").drawnCardId).toBe(x.id("red-9"));
    expect(getPlayerView(drew, "b").drawnCardId).toBeNull();
    expect(JSON.stringify(getPublicView(drew))).not.toContain(x.id("red-9"));
  });
  it("throws for an unknown player", () =>
    expect(() => getPlayerView(fixture().state, "zed")).toThrow(/Unknown player/));
  it("never contains another player's cards", () => {
    const x = fixture();
    const seen = strings(getPlayerView(x.state, "a"));
    for (const id of [...handOf(x.state, "b"), ...handOf(x.state, "c"), ...x.state.drawPile]) {
      expect(seen).not.toContain(id);
    }
  });
});

describe("leak test over whole games", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("seed %i: no view ever contains a hidden card", (seed) => {
    const game = playRandomGame(seed, { onStep: () => undefined });
    for (const state of game.states) {
      const hidden = [...state.drawPile];
      for (const viewer of state.players) {
        const seen = strings(getPlayerView(state, viewer.id));
        for (const other of state.players) {
          if (other.id === viewer.id) continue;
          for (const id of other.hand) expect(seen).not.toContain(id);
        }
        for (const id of hidden) expect(seen).not.toContain(id);
        expect(seen).not.toContain("rngState");
      }
      const pub = strings(getPublicView(state));
      for (const p of state.players) for (const id of p.hand) expect(pub).not.toContain(id);
    }
  });
});

describe("event filtering", () => {
  it("strips drawn card ids from other players' CARDS_DRAWN events", () => {
    const x = fixture();
    const { events } = run(x.state, cmd("DRAW_CARD", "a"));
    const mine = find(filterEventsForViewer(events, "a"), "CARDS_DRAWN");
    const theirs = find(filterEventsForViewer(events, "b"), "CARDS_DRAWN");
    expect(mine.cardIds).toEqual([x.id("yellow-9")]);
    expect("cardIds" in theirs).toBe(false);
    expect(theirs).toEqual({ type: "CARDS_DRAWN", playerId: "a", count: 1, reason: "voluntary" });
  });
  it("leaves other events untouched", () => {
    const x = fixture();
    const { events } = run(x.state, cmd("PLAY_CARD", "a", { cardId: x.id("red-7") }));
    expect(filterEventsForViewer(events, "b")).toEqual(events);
  });
  it("does not mutate the original events", () => {
    const x = fixture();
    const { events } = run(x.state, cmd("DRAW_CARD", "a"));
    const before = JSON.stringify(events);
    filterEventsForViewer(events, "c");
    expect(JSON.stringify(events)).toBe(before);
  });
  it("the opening-hand start has nothing private in its events", () => {
    const { events } = started(5);
    const strip = filterEventsForViewer(events, "a");
    expect(JSON.stringify(strip)).toBe(JSON.stringify(events));
    expect(applyCommand).toBeDefined();
  });
});
