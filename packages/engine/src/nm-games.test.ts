import { describe, expect, it } from "vitest";
import { applyCommand } from "./engine";
import { playRandomGame } from "./fuzz-helpers";
import { getPlayerView, getPublicView } from "./views";
import { getLegalMoves } from "./rules";
import { setup, junk } from "./test-helpers";
import type { EngineEvent, GameState } from "./types";

const nmSeeds = Array.from({ length: 30 }, (_, i) => i + 1);
const opts = { variant: "no_mercy" as const };

describe("random No Mercy games (168 cards conserved and legality consistent after every command)", () => {
  it.each(nmSeeds)("seed %i plays to a winner", (seed) => {
    const game = playRandomGame(seed, opts);
    expect(game.final.phase).toBe("match_over");
    expect(game.final.matchWinnerId).not.toBeNull();
    expect(game.final.summary?.players[0]?.id).toBe(game.final.matchWinnerId);
    expect(game.final.version).toBe(game.commands.length);
    expect(game.events.filter((e) => e.type === "COMMAND_REJECTED")).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])(
    "seed %i with a low mercy limit plays to a winner",
    (seed) => {
      const game = playRandomGame(seed, { ...opts, config: { mercyThreshold: 12 } });
      expect(game.final.phase).toBe("match_over");
      expect(game.final.matchWinnerId).not.toBeNull();
    },
  );
});

describe("every No Mercy mechanic shows up in random play", () => {
  const events: EngineEvent[] = [];
  for (const seed of nmSeeds)
    events.push(...playRandomGame(seed, { ...opts, check: false }).events);
  const lowMercy: EngineEvent[] = [];
  for (let seed = 1; seed <= 12; seed++) {
    lowMercy.push(
      ...playRandomGame(seed, { ...opts, config: { mercyThreshold: 12 }, check: false }).events,
    );
  }
  const has = (list: EngineEvent[], pred: (e: EngineEvent) => boolean) => list.some(pred);

  it("hand swaps and rotations", () => {
    expect(has(events, (e) => e.type === "HANDS_SWAPPED")).toBe(true);
    expect(has(events, (e) => e.type === "HANDS_ROTATED")).toBe(true);
  });
  it("penalty stacks", () => {
    expect(has(events, (e) => e.type === "PENALTY_PENDING" && e.total > e.topValue)).toBe(true);
    expect(has(events, (e) => e.type === "CARDS_DRAWN" && e.reason === "penalty")).toBe(true);
  });
  it("draw until playable and colour roulette", () => {
    expect(has(events, (e) => e.type === "CARDS_DRAWN" && e.reason === "draw_until_play")).toBe(
      true,
    );
    expect(has(events, (e) => e.type === "ROULETTE_STARTED")).toBe(true);
    expect(has(events, (e) => e.type === "CARDS_DRAWN" && e.reason === "color_roulette")).toBe(
      true,
    );
  });
  it("Discard All and Skip Everyone", () => {
    expect(has(events, (e) => e.type === "CARDS_DISCARDED")).toBe(true);
    expect(has(events, (e) => e.type === "PLAYER_SKIPPED" && e.reason === "skip_everyone")).toBe(
      true,
    );
  });
  it("UNO catches", () => {
    expect(has(events, (e) => e.type === "UNO_CAUGHT")).toBe(true);
  });
  it("eliminations and a last-player-standing finish", () => {
    expect(has(lowMercy, (e) => e.type === "PLAYER_ELIMINATED")).toBe(true);
    expect(
      has(lowMercy, (e) => e.type === "MATCH_ENDED" && e.summary.endReason === "last_standing"),
    ).toBe(true);
  });
});

describe("determinism", () => {
  it.each([1, 2, 3, 4, 5])("seed %i: identical inputs give identical states and events", (seed) => {
    const a = playRandomGame(seed, opts);
    const b = playRandomGame(seed, opts);
    expect(JSON.stringify(a.final)).toBe(JSON.stringify(b.final));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });
  it.each([1, 2, 3])(
    "seed %i: replaying the recorded commands reproduces the game exactly",
    (seed) => {
      const game = playRandomGame(seed, opts);
      let state = game.initial;
      const events: EngineEvent[] = [];
      for (const c of game.commands) {
        const res = applyCommand(state, c);
        events.push(...res.events);
        state = res.state;
      }
      expect(JSON.stringify(state)).toBe(JSON.stringify(game.final));
      expect(JSON.stringify(events)).toBe(JSON.stringify(game.events));
    },
  );
  it("the state is plain JSON and survives a round trip", () => {
    const game = playRandomGame(6, { ...opts, maxSteps: 40 });
    expect(JSON.stringify(JSON.parse(JSON.stringify(game.final)))).toBe(JSON.stringify(game.final));
  });
});

describe("full-game deterministic scenarios", () => {
  it("a complete 4-player game matches its stored snapshot", () => {
    const game = playRandomGame(3, { ...opts, players: 4 });
    expect(game.final.phase).toBe("match_over");
    expect(game.initial.players).toHaveLength(4);
    expect(JSON.stringify(game.final, null, 1)).toMatchSnapshot();
    expect(JSON.stringify(game.events.map((e) => e.type))).toMatchSnapshot();
  });

  it("a 4-player game that reaches a 2-player final plays out to a winner (snapshot)", () => {
    const start = setup({
      variant: "no_mercy",
      hands: {
        a: ["red-6", "red-7", "blue-1", "green-1", "yellow-1", "red-draw_two", "wd6"],
        b: ["red-8", "blue-2", "green-2", "yellow-2", "red-reverse", "red-skip", "blue-draw_four"],
        c: [],
        d: [],
      },
      top: "red-5",
      eliminated: ["c", "d"],
      draw: junk(10)
        .filter((s) => !s.includes("-1") && !s.includes("-2"))
        .slice(0, 8),
    }).state;
    const game = playRandomGame(11, { ...opts, initial: start });
    expect(game.final.phase).toBe("match_over");
    expect(["a", "b"]).toContain(game.final.matchWinnerId);
    const won = game.events.find((e) => e.type === "HAND_WON");
    expect(won && won.type === "HAND_WON" ? won.points : 0).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(game.final, null, 1)).toMatchSnapshot();
  });
});

describe("views and legal moves in No Mercy", () => {
  it("never leak a hidden card in any view over whole games", () => {
    const strings = (v: unknown, out: string[] = []): string[] => {
      if (typeof v === "string") out.push(v);
      else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          out.push(k);
          strings(x, out);
        }
      return out;
    };
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const state of playRandomGame(seed, { ...opts, check: false }).states) {
        const hidden = [...state.drawPile];
        for (const viewer of state.players) {
          const seen = strings(getPlayerView(state, viewer.id));
          for (const other of state.players) {
            if (other.id !== viewer.id) for (const id of other.hand) expect(seen).not.toContain(id);
          }
          for (const id of hidden) expect(seen).not.toContain(id);
        }
      }
    }
  });
  it("never offers a move that applyCommand would reject", () => {
    const game = playRandomGame(9, { ...opts, check: false });
    let checked = 0;
    for (const state of game.states) {
      if (
        ![
          "awaiting_play_or_draw",
          "facing_penalty",
          "awaiting_swap_target",
          "awaiting_roulette_color",
          "play_or_draw",
        ].includes(state.phase)
      )
        continue;
      const actor = (state.players[state.currentSeat] as { id: string }).id;
      for (const m of getLegalMoves(state, actor)) {
        if (
          m.type === "RESIGN" ||
          m.type === "REQUEST_SNAPSHOT" ||
          m.type === "CALL_UNO" ||
          m.type === "CATCH_UNO"
        )
          continue;
        const body: Record<string, unknown> = { ...m };
        if (m.type === "PLAY_CARD" && m.requiresColor) body.color = "red";
        const res = applyCommand(state, {
          commandId: `probe-${checked}`,
          playerId: actor,
          at: 1,
          ...body,
        } as never);
        expect(res.events[0]?.type, JSON.stringify(m)).not.toBe("COMMAND_REJECTED");
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
  it("a fresh No Mercy table exposes the new public fields as empty", () => {
    const state: GameState = playRandomGame(2, { ...opts, maxSteps: 0 }).states[1] as GameState;
    const view = getPublicView(state);
    expect(view.variant).toBe("no_mercy");
    expect([view.pendingPenalty, view.swapTargetPlayerId, view.rouletteTargetId]).toEqual([
      null,
      null,
      null,
    ]);
    expect([view.eliminatedPlayerIds, view.unoPendingWindows]).toEqual([[], []]);
  });
});
