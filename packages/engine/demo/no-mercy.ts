/**
 * Plays one complete No Mercy game (to a winner) from a seeded deck and prints a human-readable log.
 *   npm run demo:no_mercy                       (seed 7, four players)
 *   npm run demo:no_mercy -- --seed 3 --players 2 --mercy 12
 */
import {
  applyCommand,
  cardLabel,
  cardOf,
  createInitialState,
  createRng,
  getLegalMoves,
} from "../src/index";
import type { Color, Command, GameState, LegalMove } from "../src/index";
import { describeEvent } from "./log";

/** Omit that distributes over the Command union (plain Omit would collapse it). */
type Draft = Command extends infer C
  ? C extends Command
    ? Omit<C, "commandId" | "at">
    : never
  : never;

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? Number(process.argv[i + 1]) : fallback;
  return Number.isFinite(value) ? value : fallback;
};
const seed = arg("seed", 7);
const count = Math.min(10, Math.max(2, arg("players", 4)));
const mercy = arg("mercy", 25);
const NAMES = ["Ada", "Ben", "Cleo", "Dev", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jun"];
const ids = NAMES.slice(0, count);

const policy = createRng(seed + 4242);
const pick = <T>(list: T[]): T => list[Math.floor(policy.next() * list.length)] as T;

function commonestColor(state: GameState, playerId: string): Color {
  const tally: Record<string, number> = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const id of state.players.find((p) => p.id === playerId)?.hand ?? []) {
    const c = cardOf(id).color;
    if (c) tally[c] = (tally[c] ?? 0) + 1;
  }
  return (Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "red") as Color;
}

function choose(state: GameState, playerId: string, moves: LegalMove[]): Draft {
  const swaps = moves.filter(
    (m): m is Extract<LegalMove, { type: "CHOOSE_SWAP_TARGET" }> => m.type === "CHOOSE_SWAP_TARGET",
  );
  if (swaps.length > 0) {
    // Swap with whoever is holding the fewest cards.
    const best = [...swaps].sort(
      (a, b) =>
        (state.players.find((p) => p.id === a.targetId)?.hand.length ?? 99) -
        (state.players.find((p) => p.id === b.targetId)?.hand.length ?? 99),
    )[0] as (typeof swaps)[number];
    return { type: "CHOOSE_SWAP_TARGET", playerId, targetId: best.targetId };
  }
  const colorMove = moves.find((m) => m.type === "CHOOSE_COLOR");
  if (colorMove) return { type: "CHOOSE_COLOR", playerId, color: commonestColor(state, playerId) };
  const plays = moves.filter(
    (m): m is Extract<LegalMove, { type: "PLAY_CARD" }> => m.type === "PLAY_CARD",
  );
  const mustAnswer = state.phase === "facing_penalty";
  if (plays.length > 0 && (!mustAnswer || policy.next() < 0.8)) {
    const play = pick(plays);
    return {
      type: "PLAY_CARD",
      playerId,
      cardId: play.cardId,
      color: play.requiresColor ? commonestColor(state, playerId) : undefined,
      callUno: policy.next() < 0.7,
    };
  }
  return { type: "DRAW_CARD", playerId };
}

let state = createInitialState("no_mercy", ids, { mercyThreshold: mercy }, createRng(seed));
let clock = 0;
let n = 0;
const send = (c: Draft) => {
  clock += 700 + Math.floor(policy.next() * 900);
  const res = applyCommand(state, { ...c, commandId: `demo-${++n}`, at: clock } as Command);
  state = res.state;
  res.events.forEach((e, i) => {
    const line = describeEvent(e, res.events[i - 1]);
    if (line) console.log(line);
  });
};

console.log(
  `UNO No Mercy demo: seed ${seed}, ${count} players (${ids.join(", ")}), mercy limit ${mercy}`,
);
console.log("(reviewer's log: card names are shown even where real players could not see them)");
console.log("-".repeat(78));
send({ type: "START_HAND", playerId: ids[0] as string });
for (const p of state.players) console.log(`  ${p.id} holds: ${p.hand.map(cardLabel).join(", ")}`);
console.log("-".repeat(78));

let steps = 0;
while (state.phase !== "match_over" && steps++ < 8000) {
  const windows = [...(state.unoWindow ? [state.unoWindow] : []), ...state.unoPending];
  const open = windows.find(
    (w) =>
      clock - w.openedAt <= state.config.unoWindowMs &&
      state.players.find((p) => p.id === w.playerId)?.hand.length === 1,
  );
  if (open && policy.next() < 0.4) {
    const others = state.players
      .filter(
        (p) => !p.resigned && !state.eliminatedPlayerIds.includes(p.id) && p.id !== open.playerId,
      )
      .map((p) => p.id);
    send({ type: "CATCH_UNO", playerId: pick(others), targetId: open.playerId });
    continue;
  }
  const actor = (state.players[state.currentSeat] as { id: string }).id;
  send(choose(state, actor, getLegalMoves(state, actor)));
}
console.log("-".repeat(78));
console.log(
  `Finished in ${state.version} commands, phase "${state.phase}". Winner: ${state.matchWinnerId} (${state.summary?.endReason}).`,
);
for (const p of state.players) {
  const status = state.eliminatedPlayerIds.includes(p.id)
    ? "eliminated"
    : `${p.hand.length} cards left`;
  console.log(`  ${p.id}: ${status}, score ${p.score}`);
}
if (state.phase !== "match_over") process.exitCode = 1;
