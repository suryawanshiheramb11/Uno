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

const base = () =>
  setup({
    hands: {
      a: ["red-7", "blue-5", "green-1", "wild"],
      b: ["red-1", "red-2", "red-3"],
      c: ["blue-1", "blue-2", "blue-3"],
    },
    top: "red-5",
    draw: ["yellow-9", "red-9", "green-9", "blue-9"],
  });

describe("play a card", () => {
  it("plays a card matching the colour", () => {
    const g = base();
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-7") }));
    expect(state.discardPile.at(-1)).toBe(g.id("red-7"));
    expect(handOf(state, "a")).toEqual([g.id("blue-5"), g.id("green-1"), g.id("wild")]);
    expect(state.activeColor).toBe("red");
    expect(currentId(state)).toBe("b");
    expect(types(events)).toEqual(["CARD_PLAYED", "TURN_CHANGED"]);
    expect(events[0]).toEqual({
      type: "CARD_PLAYED",
      playerId: "a",
      cardId: g.id("red-7"),
      chosenColor: null,
    });
    expectConserved(state);
  });

  it("plays a card matching the number in another colour and switches the active colour", () => {
    const g = base();
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("blue-5") }));
    expect(state.activeColor).toBe("blue");
    expect(currentId(state)).toBe("b");
    expect(find(events, "CARD_PLAYED").cardId).toBe(g.id("blue-5"));
  });

  it("matches action cards by symbol across colours", () => {
    const g = setup({
      hands: {
        a: ["red-skip", "green-1", "green-2"],
        b: ["blue-1", "blue-2"],
        c: ["blue-3", "blue-4"],
      },
      top: "blue-skip",
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-skip") }));
    expect(state.activeColor).toBe("red");
  });

  it("does not match a number card against an action card of a different colour", () => {
    const g = setup({
      hands: {
        a: ["red-5", "green-1", "green-2"],
        b: ["blue-1", "blue-2"],
        c: ["blue-3", "blue-4"],
      },
      top: "blue-skip",
    });
    expectRejected(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-5") }), "CARD_NOT_PLAYABLE");
  });

  it("rejects a card matching neither colour nor number", () => {
    const g = base();
    expectRejected(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("green-1") }),
      "CARD_NOT_PLAYABLE",
    );
  });

  it("plays a zero", () => {
    const g = setup({
      hands: {
        a: ["red-0", "green-1", "green-2"],
        b: ["blue-1", "blue-2"],
        c: ["blue-3", "blue-4"],
      },
      top: "red-5",
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-0") }));
    expect(state.discardPile.at(-1)).toBe(g.id("red-0"));
  });

  it("a Wild is always playable and sets the chosen colour", () => {
    const g = base();
    const { state, events } = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("wild"), color: "green" }),
    );
    expect(state.activeColor).toBe("green");
    expect(types(events)).toEqual(["CARD_PLAYED", "COLOR_CHOSEN", "TURN_CHANGED"]);
    expect(find(events, "COLOR_CHOSEN")).toEqual({
      type: "COLOR_CHOSEN",
      playerId: "a",
      color: "green",
    });
    expect(currentId(state)).toBe("b");
  });

  it("requires a colour for a Wild", () => {
    const g = base();
    expectRejected(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wild") }), "COLOR_REQUIRED");
  });

  it("rejects an invalid colour for a Wild", () => {
    const g = base();
    expectRejected(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("wild"), color: "purple" }),
      "COLOR_INVALID",
    );
  });

  it("ignores a stray colour on a coloured card", () => {
    const g = base();
    const { state, events } = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("red-7"), color: "blue" }),
    );
    expect(state.activeColor).toBe("red");
    expect(find(events, "CARD_PLAYED").chosenColor).toBeNull();
  });

  it("after a Wild the next player must follow the new colour", () => {
    const g = setup({
      hands: {
        a: ["wild", "green-1", "green-2"],
        b: ["red-1", "blue-1", "red-3"],
        c: ["blue-2", "blue-3", "blue-4"],
      },
      top: "red-5",
    });
    const afterWild = run(
      g.state,
      cmd("PLAY_CARD", "a", { cardId: g.id("wild"), color: "blue" }),
    ).state;
    expectRejected(
      afterWild,
      cmd("PLAY_CARD", "b", { cardId: g.id("red-1") }),
      "CARD_NOT_PLAYABLE",
    );
    const ok = run(afterWild, cmd("PLAY_CARD", "b", { cardId: g.id("blue-1") }));
    expect(types(ok.events)).toEqual(["CARD_PLAYED", "TURN_CHANGED"]);
    expect(ok.state.activeColor).toBe("blue");
  });

  it("wraps around the table", () => {
    const g = setup({
      hands: { a: ["red-1", "red-2", "red-3"], b: ["red-4", "red-5#2"], c: ["red-6", "red-7"] },
      top: "red-5",
      current: "c",
    });
    const { state } = run(g.state, cmd("PLAY_CARD", "c", { cardId: g.id("red-6") }));
    expect(currentId(state)).toBe("a");
  });

  it("goes the other way when the direction is -1", () => {
    const g = setup({
      hands: { a: ["red-1", "red-2", "red-3"], b: ["red-4", "red-6"], c: ["red-7", "red-8"] },
      top: "red-5",
      direction: -1,
    });
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-1") }));
    expect(currentId(state)).toBe("c");
    expect(find(events, "TURN_CHANGED")).toEqual({
      type: "TURN_CHANGED",
      playerId: "c",
      direction: -1,
    });
  });
});

describe("draw a card", () => {
  it("draws one card from the top of the pile and ends the turn if it is unplayable", () => {
    const g = base();
    const { state, events } = run(g.state, cmd("DRAW_CARD", "a"));
    expect(handOf(state, "a")).toContain(g.id("yellow-9"));
    expect(handOf(state, "a")).toHaveLength(5);
    expect(currentId(state)).toBe("b");
    expect(types(events)).toEqual(["CARDS_DRAWN", "TURN_CHANGED"]);
    expect(events[0]).toEqual({
      type: "CARDS_DRAWN",
      playerId: "a",
      count: 1,
      cardIds: [g.id("yellow-9")],
      reason: "voluntary",
    });
    expectConserved(state);
  });

  it("keeps the turn when the drawn card is playable", () => {
    const g = setup({
      hands: { a: ["blue-5", "green-1"], b: ["blue-1", "blue-2"], c: ["blue-3", "blue-4"] },
      top: "red-5",
      draw: ["red-9"],
    });
    const { state, events } = run(g.state, cmd("DRAW_CARD", "a"));
    expect(state.phase).toBe("play_or_draw");
    expect(state.drawnCardId).toBe(g.id("red-9"));
    expect(currentId(state)).toBe("a");
    expect(types(events)).toEqual(["CARDS_DRAWN"]);
  });

  it("lets the player play the drawn card", () => {
    const g = setup({
      hands: { a: ["blue-5", "green-1"], b: ["blue-1", "blue-2"], c: ["blue-3", "blue-4"] },
      top: "red-5",
      draw: ["red-9"],
    });
    const drew = run(g.state, cmd("DRAW_CARD", "a")).state;
    const { state, events } = run(drew, cmd("PLAY_CARD", "a", { cardId: g.id("red-9") }));
    expect(state.discardPile.at(-1)).toBe(g.id("red-9"));
    expect(state.drawnCardId).toBeNull();
    expect(currentId(state)).toBe("b");
    expect(types(events)).toEqual(["CARD_PLAYED", "TURN_CHANGED"]);
  });

  it("only the drawn card may be played after drawing", () => {
    const g = setup({
      hands: { a: ["red-1", "green-1"], b: ["blue-1", "blue-2"], c: ["blue-3", "blue-4"] },
      top: "red-5",
      draw: ["red-9"],
    });
    const drew = run(g.state, cmd("DRAW_CARD", "a")).state;
    expectRejected(drew, cmd("PLAY_CARD", "a", { cardId: g.id("red-1") }), "NOT_DRAWN_CARD");
  });

  it("can pass after drawing a playable card", () => {
    const g = setup({
      hands: { a: ["blue-5", "green-1"], b: ["blue-1", "blue-2"], c: ["blue-3", "blue-4"] },
      top: "red-5",
      draw: ["red-9"],
    });
    const drew = run(g.state, cmd("DRAW_CARD", "a")).state;
    const { state, events } = run(drew, cmd("PASS_TURN", "a"));
    expect(types(events)).toEqual(["TURN_PASSED", "TURN_CHANGED"]);
    expect(currentId(state)).toBe("b");
    expect(handOf(state, "a")).toContain(g.id("red-9"));
    expect(state.drawnCardId).toBeNull();
  });

  it("cannot draw twice in one turn", () => {
    const g = setup({
      hands: { a: ["blue-5", "green-1"], b: ["blue-1", "blue-2"], c: ["blue-3", "blue-4"] },
      top: "red-5",
      draw: ["red-9"],
    });
    const drew = run(g.state, cmd("DRAW_CARD", "a")).state;
    expectRejected(drew, cmd("DRAW_CARD", "a"), "ALREADY_DREW");
  });

  it("cannot pass without drawing", () => {
    const g = base();
    expectRejected(g.state, cmd("PASS_TURN", "a"), "NOTHING_TO_PASS");
  });

  it("may draw even while holding a playable card", () => {
    const g = base();
    expect(getLegalMoves(g.state, "a").some((m) => m.type === "PLAY_CARD")).toBe(true);
    const { state, events } = run(g.state, cmd("DRAW_CARD", "a"));
    expect(handOf(state, "a")).toHaveLength(5);
    expect(types(events)).not.toContain("COMMAND_REJECTED");
  });

  it("draws cards in pile order across turns", () => {
    const g = setup({
      hands: { a: ["green-1", "green-2"], b: ["green-3", "green-4"], c: ["blue-3", "blue-4"] },
      top: "red-5",
      draw: ["yellow-1", "yellow-2"],
    });
    const s1 = run(g.state, cmd("DRAW_CARD", "a")).state;
    const s2 = run(s1, cmd("DRAW_CARD", "b")).state;
    expect(handOf(s1, "a")).toContain(g.id("yellow-1"));
    expect(handOf(s2, "b")).toContain(g.id("yellow-2"));
  });

  it("drawing a Wild leaves the player able to play it", () => {
    const g = setup({
      hands: { a: ["green-1", "green-2"], b: ["blue-1", "blue-2"], c: ["blue-3", "blue-4"] },
      top: "red-5",
      draw: ["wild"],
    });
    const { state } = run(g.state, cmd("DRAW_CARD", "a"));
    expect(state.phase).toBe("play_or_draw");
    expect(getLegalMoves(state, "a").map((m) => m.type)).toEqual([
      "PLAY_CARD",
      "PASS_TURN",
      "RESIGN",
      "REQUEST_SNAPSHOT",
    ]);
  });
});
