import { describe, expect, it } from "vitest";
import { cmd, currentId, find, handOf, run, setup, types } from "./test-helpers";

const duel = (a: string[], extra: Partial<Parameters<typeof setup>[0]> = {}) =>
  setup({
    hands: { a, b: ["blue-1", "blue-2", "blue-3"] },
    top: "red-5",
    draw: ["yellow-1", "yellow-2", "yellow-3", "yellow-4", "yellow-5", "yellow-6"],
    ...extra,
  });

describe("two-player special rules", () => {
  it("Reverse acts as Skip: the player goes again", () => {
    const g = duel(["red-reverse", "red-1", "red-2"]);
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-reverse") }));
    expect(currentId(state)).toBe("a");
    expect(state.direction).toBe(-1);
    expect(types(events)).toEqual([
      "CARD_PLAYED",
      "DIRECTION_REVERSED",
      "PLAYER_SKIPPED",
      "TURN_CHANGED",
    ]);
    expect(find(events, "PLAYER_SKIPPED")).toEqual({
      type: "PLAYER_SKIPPED",
      playerId: "b",
      reason: "reverse_two_player",
    });
  });
  it("two Reverses leave the direction unchanged and the same player on turn", () => {
    const g = duel(["red-reverse", "red-reverse#2", "red-2"]);
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-reverse") })).state;
    const { state } = run(s1, cmd("PLAY_CARD", "a", { cardId: g.id("red-reverse#2") }));
    expect(state.direction).toBe(1);
    expect(currentId(state)).toBe("a");
  });
  it("Skip gives the player another turn", () => {
    const g = duel(["red-skip", "red-1", "red-2"]);
    const { state, events } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-skip") }));
    expect(currentId(state)).toBe("a");
    expect(types(events)).toEqual(["CARD_PLAYED", "PLAYER_SKIPPED", "TURN_CHANGED"]);
    expect(find(events, "PLAYER_SKIPPED").playerId).toBe("b");
  });
  it("Draw Two: the opponent draws two and the player goes again", () => {
    const g = duel(["red-draw_two", "red-1", "red-2"]);
    const { state } = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-draw_two") }));
    expect(handOf(state, "b")).toHaveLength(5);
    expect(currentId(state)).toBe("a");
  });
  it("normal plays alternate", () => {
    const g = setup({
      hands: { a: ["red-1", "red-2", "red-3"], b: ["red-4", "red-6", "red-7"] },
      top: "red-5",
    });
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("red-1") })).state;
    expect(currentId(s1)).toBe("b");
    expect(currentId(run(s1, cmd("PLAY_CARD", "b", { cardId: g.id("red-4") })).state)).toBe("a");
  });
  it("Wild Draw Four accepted: the opponent draws four and the player goes again", () => {
    const g = duel(["wd4", "blue-5", "green-1"]);
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wd4"), color: "green" })).state;
    const res = run(s1, cmd("DRAW_CARD", "b"));
    expect(handOf(res.state, "b")).toHaveLength(7);
    expect(currentId(res.state)).toBe("a");
  });
  it("Wild Draw Four challenge fails: the challenger draws six and the player goes again", () => {
    const g = duel(["wd4", "blue-5", "green-1"]);
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wd4"), color: "green" })).state;
    const res = run(s1, cmd("CHALLENGE_WILD_DRAW_FOUR", "b"));
    expect(handOf(res.state, "b")).toHaveLength(9);
    expect(currentId(res.state)).toBe("a");
  });
  it("Wild Draw Four challenge succeeds: the player draws four and the challenger plays", () => {
    const g = duel(["wd4", "red-7", "green-1"]);
    const s1 = run(g.state, cmd("PLAY_CARD", "a", { cardId: g.id("wd4"), color: "green" })).state;
    const res = run(s1, cmd("CHALLENGE_WILD_DRAW_FOUR", "b"));
    expect(handOf(res.state, "a")).toHaveLength(6);
    expect(currentId(res.state)).toBe("b");
  });
});
