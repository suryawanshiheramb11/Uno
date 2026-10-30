import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { playRandomGame } from "./fuzz-helpers";
import { cmd, started } from "./test-helpers";

const seeds = Array.from({ length: 30 }, (_, i) => i + 1);

describe("random whole games (invariants checked after every command)", () => {
  it.each(seeds)(
    "seed %i plays to a finished match with 108 cards conserved and legality consistent",
    (seed) => {
      const game = playRandomGame(seed);
      expect(game.final.phase).toBe("match_over");
      expect(game.final.matchWinnerId).not.toBeNull();
      expect(game.final.summary?.players[0]?.id).toBe(game.final.matchWinnerId);
      expect(game.final.version).toBe(game.commands.length);
      expect(game.events.filter((e) => e.type === "COMMAND_REJECTED")).toEqual([]);
    },
  );
});

describe("determinism", () => {
  it.each([1, 2, 3, 4, 5])(
    "seed %i: the same inputs give the identical final state and events",
    (seed) => {
      const a = playRandomGame(seed);
      const b = playRandomGame(seed);
      expect(JSON.stringify(a.final)).toBe(JSON.stringify(b.final));
      expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    },
  );

  it.each([1, 2, 3])(
    "seed %i: replaying the recorded commands reproduces the game exactly",
    (seed) => {
      const game = playRandomGame(seed);
      let state = game.initial;
      const events = [];
      for (const c of game.commands) {
        const res = applyCommand(state, c);
        events.push(...res.events);
        state = res.state;
      }
      expect(JSON.stringify(state)).toBe(JSON.stringify(game.final));
      expect(JSON.stringify(events)).toBe(JSON.stringify(game.events));
    },
  );

  it("different seeds produce different games", () => {
    expect(JSON.stringify(playRandomGame(1).final)).not.toBe(
      JSON.stringify(playRandomGame(2).final),
    );
  });

  it("matches a stored JSON snapshot of the state after 40 commands (seed 42)", () => {
    const game = playRandomGame(42, { maxSteps: 39 });
    expect(game.commands).toHaveLength(40);
    expect(JSON.stringify(game.final, null, 1)).toMatchSnapshot();
  });

  it("matches a stored JSON snapshot of the event log (seed 42, 40 commands)", () => {
    const game = playRandomGame(42, { maxSteps: 39 });
    expect(JSON.stringify(game.events, null, 1)).toMatchSnapshot();
  });

  it("applyCommand does not mutate its input state", () => {
    const { state } = started(9);
    const before = JSON.stringify(state);
    applyCommand(state, cmd("DRAW_CARD", "a"));
    applyCommand(state, cmd("DRAW_CARD", "b"));
    expect(JSON.stringify(state)).toBe(before);
  });

  it("the state is plain JSON: a serialised state continues identically", () => {
    const game = playRandomGame(4, { maxSteps: 20 });
    const revived = JSON.parse(JSON.stringify(game.final));
    const c = cmd("REQUEST_SNAPSHOT", "p0");
    expect(applyCommand(revived, c).events).toEqual(applyCommand(game.final, c).events);
    const next = game.states.at(-1);
    expect(JSON.stringify(revived)).toBe(JSON.stringify(next));
  });
});
