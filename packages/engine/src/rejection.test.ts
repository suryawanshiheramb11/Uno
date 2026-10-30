import { describe, expect, it } from "vitest";
import { applyCommand } from "./engine";
import type { Command, RejectReason } from "./types";
import { cmd, expectRejected, find, run, setup, types } from "./test-helpers";

const g = () =>
  setup({
    hands: {
      a: ["red-7", "blue-5", "green-1"],
      b: ["red-1", "red-2", "red-3"],
      c: ["blue-1", "blue-2", "blue-3"],
    },
    top: "red-5",
    draw: ["yellow-9", "yellow-8"],
  });

describe("malformed commands", () => {
  const s = g().state;
  const cases: Array<[string, unknown]> = [
    ["null", null],
    ["a string", "PLAY_CARD"],
    ["no commandId", { type: "DRAW_CARD", playerId: "a", at: 1 }],
    ["empty commandId", { type: "DRAW_CARD", commandId: "", playerId: "a", at: 1 }],
    ["no playerId", { type: "DRAW_CARD", commandId: "x", at: 1 }],
    ["unknown type", { type: "TELEPORT", commandId: "x", playerId: "a", at: 1 }],
    ["NaN timestamp", { type: "DRAW_CARD", commandId: "x", playerId: "a", at: Number.NaN }],
    ["string timestamp", { type: "DRAW_CARD", commandId: "x", playerId: "a", at: "now" }],
  ];
  it.each(cases)("rejects %s with MALFORMED_COMMAND and leaves state untouched", (_name, bad) => {
    const res = applyCommand(s, bad as Command);
    expect(res.state).toBe(s);
    expect(res.events).toHaveLength(1);
    expect(find(res.events, "COMMAND_REJECTED").reason).toBe("MALFORMED_COMMAND");
  });
});

describe("membership and turn order", () => {
  it("unknown player", () => expectRejected(g().state, cmd("DRAW_CARD", "zed"), "UNKNOWN_PLAYER"));
  it("play out of turn", () => {
    const x = g();
    expectRejected(x.state, cmd("PLAY_CARD", "b", { cardId: x.id("red-1") }), "NOT_YOUR_TURN");
  });
  it("draw out of turn", () => expectRejected(g().state, cmd("DRAW_CARD", "b"), "NOT_YOUR_TURN"));
  it("pass out of turn", () => expectRejected(g().state, cmd("PASS_TURN", "c"), "NOT_YOUR_TURN"));
  it("resigned players cannot act", () => {
    const x = g();
    const after = run(x.state, cmd("RESIGN", "c")).state;
    expectRejected(after, cmd("DRAW_CARD", "c"), "PLAYER_RESIGNED");
  });
});

describe("card ownership and legality", () => {
  it("a card in someone else's hand", () => {
    const x = g();
    expectRejected(x.state, cmd("PLAY_CARD", "a", { cardId: x.id("red-1") }), "CARD_NOT_IN_HAND");
  });
  it("a garbage card id", () =>
    expectRejected(g().state, cmd("PLAY_CARD", "a", { cardId: "nope" }), "CARD_NOT_IN_HAND"));
  it("a card id with an out-of-range index", () =>
    expectRejected(g().state, cmd("PLAY_CARD", "a", { cardId: "7-999" }), "CARD_NOT_IN_HAND"));
  it("a card still in the draw pile", () => {
    const x = g();
    expectRejected(
      x.state,
      cmd("PLAY_CARD", "a", { cardId: x.id("yellow-9") }),
      "CARD_NOT_IN_HAND",
    );
  });
  it("a missing card id", () =>
    expectRejected(g().state, cmd("PLAY_CARD", "a", {}), "CARD_NOT_IN_HAND"));
  it("an unplayable card", () => {
    const x = g();
    expectRejected(
      x.state,
      cmd("PLAY_CARD", "a", { cardId: x.id("green-1") }),
      "CARD_NOT_PLAYABLE",
    );
  });
});

describe("phases", () => {
  it("CHOOSE_COLOR outside the opening choice", () =>
    expectRejected(g().state, cmd("CHOOSE_COLOR", "a", { color: "red" }), "WRONG_PHASE"));
  it("VOTE_REMATCH during a hand", () =>
    expectRejected(g().state, cmd("VOTE_REMATCH", "a"), "WRONG_PHASE"));
  it("play before the hand starts", () => {
    const x = setup({ hands: { a: ["red-7"], b: ["red-1"] }, top: "red-5", phase: "pre_hand" });
    expectRejected(x.state, cmd("PLAY_CARD", "a", { cardId: x.id("red-7") }), "HAND_NOT_STARTED");
    expectRejected(x.state, cmd("DRAW_CARD", "a"), "HAND_NOT_STARTED");
    expectRejected(x.state, cmd("PASS_TURN", "a"), "HAND_NOT_STARTED");
  });
  it("START_HAND mid-hand", () =>
    expectRejected(g().state, cmd("START_HAND", "a"), "HAND_IN_PROGRESS"));
});

describe("idempotency", () => {
  it("replaying an accepted command id is rejected as a duplicate", () => {
    const x = g();
    const c = cmd("DRAW_CARD", "a");
    const first = run(x.state, c);
    expect(first.state.seenCommandIds).toEqual([c.commandId]);
    expectRejected(first.state, c, "DUPLICATE_COMMAND");
  });
  it("a duplicate cannot be replayed by another player either", () => {
    const x = g();
    const c = cmd("DRAW_CARD", "a");
    const s1 = run(x.state, c).state;
    expectRejected(s1, { ...c, playerId: "b" } as Command, "DUPLICATE_COMMAND");
  });
  it("a rejected command does not consume its id", () => {
    const x = g();
    const bad = cmd("DRAW_CARD", "b");
    expectRejected(x.state, bad, "NOT_YOUR_TURN");
    const retry = { ...bad, playerId: "a" } as Command;
    expect(types(run(x.state, retry).events)).toEqual(["CARDS_DRAWN", "TURN_CHANGED"]);
  });
  it("accepted commands bump the version by one each", () => {
    const x = g();
    const s1 = run(x.state, cmd("DRAW_CARD", "a")).state;
    expect(s1.version).toBe(x.state.version + 1);
  });
});

describe("REQUEST_SNAPSHOT", () => {
  it("changes nothing and emits SNAPSHOT_REQUESTED", () => {
    const x = g();
    const res = run(x.state, cmd("REQUEST_SNAPSHOT", "b"));
    expect(res.state).toBe(x.state);
    expect(res.events).toEqual([{ type: "SNAPSHOT_REQUESTED", playerId: "b" }]);
  });
  it("is allowed out of turn and repeatedly", () => {
    const x = g();
    const c = cmd("REQUEST_SNAPSHOT", "c");
    expect(run(x.state, c).events).toHaveLength(1);
    expect(run(x.state, c).events[0]?.type).toBe("SNAPSHOT_REQUESTED");
  });
  it("is rejected for strangers", () =>
    expectRejected(g().state, cmd("REQUEST_SNAPSHOT", "zed"), "UNKNOWN_PLAYER"));
});

describe("typed reason codes", () => {
  it("every rejection carries a SCREAMING_SNAKE reason, never prose", () => {
    const x = g();
    const attempts: Command[] = [
      cmd("DRAW_CARD", "b"),
      cmd("PLAY_CARD", "a", { cardId: "nope" }),
      cmd("CHOOSE_COLOR", "a", { color: "red" }),
      cmd("CHALLENGE_WILD_DRAW_FOUR", "b"),
      cmd("CALL_UNO", "a"),
      cmd("PASS_TURN", "a"),
    ];
    const reasons: RejectReason[] = attempts.map(
      (c) => find(run(x.state, c).events, "COMMAND_REJECTED").reason,
    );
    expect(reasons).toEqual([
      "NOT_YOUR_TURN",
      "CARD_NOT_IN_HAND",
      "WRONG_PHASE",
      "NO_CHALLENGE_PENDING",
      "NOT_AT_UNO",
      "NOTHING_TO_PASS",
    ]);
    for (const r of reasons) expect(r).toMatch(/^[A-Z_]+$/);
  });
  it("the rejection event echoes the command id, player and type", () => {
    const x = g();
    const c = cmd("DRAW_CARD", "b");
    expect(run(x.state, c).events).toEqual([
      {
        type: "COMMAND_REJECTED",
        commandId: c.commandId,
        playerId: "b",
        commandType: "DRAW_CARD",
        reason: "NOT_YOUR_TURN",
      },
    ]);
  });
});
