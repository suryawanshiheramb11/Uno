/**
 * Plays one complete Classic hand from a seeded deck and prints a human-readable event log.
 *   npm run demo:classic                 (seed 2024, three players)
 *   npm run demo:classic -- --seed 7 --players 4
 */
import {
  applyCommand,
  cardLabel,
  cardOf,
  createInitialState,
  createRng,
  getLegalMoves,
} from "../src/index";
import type { Color, Command, EngineEvent, GameState, LegalMove } from "../src/index";

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
const seed = arg("seed", 2024);
const count = Math.min(10, Math.max(2, arg("players", 3)));
const NAMES = ["Ada", "Ben", "Cleo", "Dev", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jun"];
const ids = NAMES.slice(0, count);

const cards = (list: string[]) => list.map(cardLabel).join(", ");
const nameOf = (id: string) => id;

function describe(e: EngineEvent, state: GameState): string | null {
  switch (e.type) {
    case "HAND_STARTED":
      return `Hand ${e.handNumber} dealt. Dealer ${e.dealerId}; ${e.firstPlayerId} is first.`;
    case "OPENING_CARD_RESHUFFLED":
      return `Opening card was ${cardLabel(e.cardId)}: shuffled back into the pile, flipping again.`;
    case "OPENING_CARD":
      return `Opening card: ${cardLabel(e.cardId)}`;
    case "CARD_PLAYED":
      return `${nameOf(e.playerId)} plays ${cardLabel(e.cardId)}${e.chosenColor ? ` and calls ${e.chosenColor}` : ""}`;
    case "CARDS_DRAWN":
      return `${nameOf(e.playerId)} draws ${e.count} (${e.reason.replace(/_/g, " ")})`;
    case "TURN_CHANGED":
      return `   -> ${nameOf(e.playerId)}'s turn (${e.direction === 1 ? "clockwise" : "counter-clockwise"})`;
    case "TURN_PASSED":
      return `${nameOf(e.playerId)} keeps the drawn card and passes`;
    case "DIRECTION_REVERSED":
      return `Direction reverses`;
    case "PLAYER_SKIPPED":
      return `${nameOf(e.playerId)} is skipped (${e.reason.replace(/_/g, " ")})`;
    case "COLOR_CHOSEN":
      // A Wild's colour is already part of its "plays ... and calls" line.
      return state.discardPile.length > 1 || state.phase === "awaiting_opening_color"
        ? null
        : `${nameOf(e.playerId)} chooses ${e.color}`;
    case "UNO_CALLED":
      return `${nameOf(e.playerId)} calls UNO!`;
    case "UNO_CAUGHT":
      return `${nameOf(e.catcherId)} catches ${nameOf(e.targetId)} without UNO!`;
    case "CHALLENGE_RESOLVED":
      return `${nameOf(e.challengerId)} challenges ${nameOf(e.accusedId)}: ${e.success ? "SUCCESS, the bluff is exposed" : "FAILED, the play was legal"}`;
    case "CHALLENGE_DECLINED":
      return `${nameOf(e.playerId)} declines to challenge`;
    case "DRAW_PILE_RESHUFFLED":
      return `Draw pile empty: reshuffled ${e.cardCount} cards from the discard pile`;
    case "HAND_WON": {
      const scores = Object.entries(e.scores)
        .map(([id, s]) => `${id} ${s}`)
        .join(", ");
      return `*** ${nameOf(e.winnerId)} WINS THE HAND for ${e.points} points (${scores})`;
    }
    case "MATCH_ENDED":
      return `Match over: ${e.summary.winnerId} (${e.summary.endReason}). Placements: ${e.summary.players.map((p) => `${p.placement}. ${p.id}`).join(", ")}`;
    case "COMMAND_REJECTED":
      return `!! REJECTED ${e.commandType} from ${e.playerId}: ${e.reason}`;
    default:
      void state;
      return null;
  }
}

// A deliberately simple table of bots; the server will use the real bot package later.
const policy = createRng(seed + 99);
const pick = <T>(list: T[]): T => list[Math.floor(policy.next() * list.length)] as T;

function chooseColor(state: GameState, playerId: string): Color {
  const hand = state.players.find((p) => p.id === playerId)?.hand ?? [];
  const tally: Record<string, number> = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const id of hand) {
    const c = cardOf(id).color;
    if (c) tally[c] = (tally[c] ?? 0) + 1;
  }
  return (Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "red") as Color;
}

function choose(state: GameState, playerId: string, moves: LegalMove[]): Draft {
  const challenge = moves.find((m) => m.type === "CHALLENGE_WILD_DRAW_FOUR");
  if (challenge) {
    return policy.next() < 0.4
      ? { type: "CHALLENGE_WILD_DRAW_FOUR", playerId }
      : { type: "DRAW_CARD", playerId };
  }
  const colorMove = moves.find((m) => m.type === "CHOOSE_COLOR");
  if (colorMove) return { type: "CHOOSE_COLOR", playerId, color: chooseColor(state, playerId) };
  const plays = moves.filter(
    (m): m is Extract<LegalMove, { type: "PLAY_CARD" }> => m.type === "PLAY_CARD",
  );
  if (plays.length > 0) {
    const nonWild = plays.filter((m) => !m.requiresColor);
    const play = nonWild.length > 0 ? pick(nonWild) : pick(plays);
    return {
      type: "PLAY_CARD",
      playerId,
      cardId: play.cardId,
      color: play.requiresColor ? chooseColor(state, playerId) : undefined,
      callUno: policy.next() < 0.7,
    };
  }
  if (moves.some((m) => m.type === "PASS_TURN")) return { type: "PASS_TURN", playerId };
  return { type: "DRAW_CARD", playerId };
}

let state = createInitialState("classic", ids, {}, createRng(seed));
let clock = 0;
let n = 0;
const send = (c: Draft) => {
  clock += 700 + Math.floor(policy.next() * 900);
  const res = applyCommand(state, { ...c, commandId: `demo-${++n}`, at: clock } as Command);
  state = res.state;
  for (const e of res.events) {
    const line = describe(e, state);
    if (line) console.log(line);
  }
  return res.events;
};

console.log(`UNO Classic demo: seed ${seed}, ${count} players (${ids.join(", ")})`);
console.log("-".repeat(72));
send({ type: "START_HAND", playerId: ids[0] as string });
for (const p of state.players) console.log(`  ${p.id} holds: ${cards(p.hand)}`);
console.log("-".repeat(72));

let turns = 0;
while (state.phase !== "match_over" && turns++ < 5000) {
  const w = state.unoWindow;
  if (w && clock - w.openedAt <= state.config.unoWindowMs && policy.next() < 0.3) {
    send({
      type: "CATCH_UNO",
      playerId: pick(ids.filter((id) => id !== w.playerId)),
      targetId: w.playerId,
    });
    continue;
  }
  const actor = (state.players[state.currentSeat] as { id: string }).id;
  const moves = getLegalMoves(state, actor);
  send(choose(state, actor, moves));
}
console.log("-".repeat(72));
console.log(
  `Finished in ${state.version} commands, phase "${state.phase}". Cards left in the draw pile: ${state.drawPile.length}.`,
);
for (const p of state.players)
  console.log(`  ${p.id}: ${p.hand.length} cards left, score ${p.score}`);
if (state.phase !== "match_over") process.exitCode = 1;
