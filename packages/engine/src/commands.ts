import {
  clone,
  playerAt,
  seatOf,
  isNoMercy,
  handEnded,
  clearUnoFor,
  reshuffleIfNeeded,
  atMercyLimit,
  eliminate,
  drawCards,
  advanceTurn,
  closeUnoWindowForOthers,
  clearVariantState,
  endMatch,
  endHand,
  startHand,
  swapHands,
  rotateHands,
  stackPenalty,
} from "./effects";
import type { Events } from "./effects";
import { cardDefOf, drawValue, isValidCardId } from "./cards";
import {
  activeSeats,
  canPlayCard,
  hasPlayableCard,
  isActive,
  isEliminated,
  isInHand,
  needsColorChoice,
  stepSeat,
} from "./rules";
import { COLORS } from "./types";
import type { Color, Command, EngineEvent, GameState, RejectReason } from "./types";

type Handler<C extends Command = Command> = (
  s: GameState,
  cmd: C,
  events: Events,
) => RejectReason | null;

// ------------------------------------------------------------------ handlers

const startHandCmd: Handler = (s, _cmd, events) => {
  if (s.phase === "match_over") return "MATCH_OVER";
  if (isInHand(s)) return "HAND_IN_PROGRESS";
  startHand(s, events);
  return null;
};

function phaseRejection(s: GameState): RejectReason | null {
  switch (s.phase) {
    case "pre_hand":
      return "HAND_NOT_STARTED";
    case "hand_over":
      return "HAND_OVER";
    case "match_over":
      return "MATCH_OVER";
    default:
      return null;
  }
}

const playCard: Handler<Extract<Command, { type: "PLAY_CARD" }>> = (s, cmd, events) => {
  const gate = phaseRejection(s);
  if (gate) return gate;
  const seat = seatOf(s, cmd.playerId);
  if (seat !== s.currentSeat) return "NOT_YOUR_TURN";
  if (s.phase === "awaiting_challenge") return "CHALLENGE_PENDING";
  if (s.phase === "awaiting_opening_color" || s.phase === "awaiting_roulette_color") {
    return "COLOR_CHOICE_PENDING";
  }
  if (s.phase === "awaiting_swap_target") return "SWAP_TARGET_PENDING";
  const player = playerAt(s, seat);
  if (!isValidCardId(cmd.cardId) || !player.hand.includes(cmd.cardId)) return "CARD_NOT_IN_HAND";
  if (s.phase === "play_or_draw" && cmd.cardId !== s.drawnCardId) return "NOT_DRAWN_CARD";
  const def = cardDefOf(cmd.cardId);
  if (!canPlayCard(s, player, cmd.cardId)) {
    if (s.phase === "facing_penalty")
      return drawValue(def) > 0 ? "STACK_TOO_LOW" : "MUST_STACK_OR_DRAW";
    return def.face === "wild_draw_four" ? "WILD_DRAW_FOUR_ILLEGAL" : "CARD_NOT_PLAYABLE";
  }
  let chosen: Color | null = null;
  if (needsColorChoice(def)) {
    if (cmd.color === undefined) return "COLOR_REQUIRED";
    if (!COLORS.includes(cmd.color)) return "COLOR_INVALID";
    chosen = cmd.color;
  }

  const nm = isNoMercy(s);
  const previousColor = s.activeColor as Color;
  closeUnoWindowForOthers(s, player.id);
  player.hand.splice(player.hand.indexOf(cmd.cardId), 1);
  // Discard All: every other card of its colour goes down with it, underneath.
  let extras: string[] = [];
  if (def.face === "discard_all") {
    extras = player.hand.filter((id) => cardDefOf(id).color === def.color);
    player.hand = player.hand.filter((id) => !extras.includes(id));
    s.discardPile.push(...extras);
  }
  s.discardPile.push(cmd.cardId);
  s.drawnCardId = null;
  s.activeColor = def.color ?? chosen ?? s.activeColor;
  events.push({
    type: "CARD_PLAYED",
    playerId: player.id,
    cardId: cmd.cardId,
    chosenColor: chosen,
  });
  if (extras.length > 0)
    events.push({ type: "CARDS_DISCARDED", playerId: player.id, cardIds: extras });
  if (chosen) events.push({ type: "COLOR_CHOSEN", playerId: player.id, color: chosen });

  if (player.hand.length === 1) {
    if (cmd.callUno) {
      player.unoCalled = true;
      events.push({ type: "UNO_CALLED", playerId: player.id });
    } else {
      s.unoWindow = { playerId: player.id, openedAt: cmd.at };
    }
  }

  const won = player.hand.length === 0;
  let advance: number | null = 1;
  switch (def.face) {
    case "number":
      if (nm && (s.config.sevenZeroRules ?? true) && !won) {
        if (def.value === 7) {
          s.swapTargetAwaiting = { playerId: player.id };
          s.phase = "awaiting_swap_target";
          events.push({ type: "SWAP_TARGET_REQUESTED", playerId: player.id });
          advance = null;
        } else if (def.value === 0) {
          rotateHands(s, seat, cmd.at, events);
        }
      }
      break;
    case "wild":
    case "discard_all":
      break;
    case "skip": {
      if (!won) {
        events.push({
          type: "PLAYER_SKIPPED",
          playerId: playerAt(s, stepSeat(s, seat, s.direction, 1)).id,
          reason: "skip",
        });
      }
      advance = 2;
      break;
    }
    case "reverse": {
      s.direction = s.direction === 1 ? -1 : 1;
      events.push({ type: "DIRECTION_REVERSED", direction: s.direction });
      if (activeSeats(s).length === 2) {
        if (!won) {
          events.push({
            type: "PLAYER_SKIPPED",
            playerId: playerAt(s, stepSeat(s, seat, s.direction, 1)).id,
            reason: "reverse_two_player",
          });
        }
        advance = 2;
      }
      break;
    }
    case "draw_two": {
      if (nm) {
        stackPenalty(s, seat, def, won, events);
        advance = null;
        break;
      }
      const victim = stepSeat(s, seat, s.direction, 1);
      drawCards(s, victim, 2, "draw_two", events);
      if (!won)
        events.push({
          type: "PLAYER_SKIPPED",
          playerId: playerAt(s, victim).id,
          reason: "draw_two",
        });
      advance = 2;
      break;
    }
    case "wild_draw_four": {
      const victim = stepSeat(s, seat, s.direction, 1);
      if (won) {
        drawCards(s, victim, 4, "wild_draw_four", events);
        advance = 2;
      } else {
        s.pendingChallenge = {
          playedById: player.id,
          targetId: playerAt(s, victim).id,
          previousColor,
          hadMatchingColor: player.hand.some((id) => cardDefOf(id).color === previousColor),
        };
        s.currentSeat = victim;
        s.phase = "awaiting_challenge";
        events.push({
          type: "TURN_CHANGED",
          playerId: playerAt(s, victim).id,
          direction: s.direction,
        });
        advance = null;
      }
      break;
    }
    case "draw_four":
    case "wild_reverse_draw_four":
    case "wild_draw_six":
    case "wild_draw_ten":
      stackPenalty(s, seat, def, won, events);
      advance = null;
      break;
    case "skip_everyone": {
      if (!won) {
        let other = stepSeat(s, seat, s.direction, 1);
        while (other !== seat) {
          events.push({
            type: "PLAYER_SKIPPED",
            playerId: playerAt(s, other).id,
            reason: "skip_everyone",
          });
          other = stepSeat(s, other, s.direction, 1);
        }
      }
      advance = 0;
      break;
    }
    case "wild_color_roulette": {
      if (!won) {
        const target = stepSeat(s, seat, s.direction, 1);
        s.colorRouletteActive = { playedById: player.id, targetId: playerAt(s, target).id };
        s.currentSeat = target;
        s.phase = "awaiting_roulette_color";
        events.push({
          type: "ROULETTE_STARTED",
          playerId: player.id,
          targetId: playerAt(s, target).id,
        });
        events.push({
          type: "TURN_CHANGED",
          playerId: playerAt(s, target).id,
          direction: s.direction,
        });
        advance = null;
      }
      break;
    }
  }
  if (won) {
    if (!handEnded(s)) endHand(s, seat, events);
    return null;
  }
  if (handEnded(s)) return null;
  if (advance !== null) advanceTurn(s, seat, advance, events);
  return null;
};

const drawCard: Handler = (s, cmd, events) => {
  const gate = phaseRejection(s);
  if (gate) return gate;
  const seat = seatOf(s, cmd.playerId);
  if (seat !== s.currentSeat) return "NOT_YOUR_TURN";
  if (s.phase === "awaiting_opening_color" || s.phase === "awaiting_roulette_color") {
    return "COLOR_CHOICE_PENDING";
  }
  if (s.phase === "awaiting_swap_target") return "SWAP_TARGET_PENDING";
  if (s.phase === "play_or_draw") return "ALREADY_DREW";
  const player = playerAt(s, seat);
  closeUnoWindowForOthers(s, player.id);
  if (s.phase === "awaiting_challenge") {
    events.push({ type: "CHALLENGE_DECLINED", playerId: player.id });
    s.pendingChallenge = null;
    drawCards(s, seat, 4, "wild_draw_four", events);
    advanceTurn(s, seat, 1, events);
    return null;
  }
  if (s.phase === "facing_penalty") {
    // Taking the whole stack ends the turn.
    const total = s.pendingPenalty?.total ?? 0;
    s.pendingPenalty = null;
    drawCards(s, seat, total, "penalty", events);
    if (handEnded(s)) return null;
    advanceTurn(s, seat, 1, events);
    return null;
  }
  if (isNoMercy(s)) {
    if (hasPlayableCard(s, player)) return "CANNOT_DRAW_WITH_PLAYABLE";
    // Draw until you can play: the first playable card drawn becomes the only legal move.
    for (;;) {
      reshuffleIfNeeded(s, events);
      const id = s.drawPile.pop();
      if (id === undefined) {
        advanceTurn(s, seat, 1, events);
        break;
      }
      player.hand.push(id);
      player.unoCalled = false;
      clearUnoFor(s, player.id);
      events.push({
        type: "CARDS_DRAWN",
        playerId: player.id,
        count: 1,
        cardIds: [id],
        reason: "draw_until_play",
      });
      if (atMercyLimit(s, player)) {
        eliminate(s, seat, events);
        if (!handEnded(s)) advanceTurn(s, seat, 1, events);
        break;
      }
      if (canPlayCard(s, player, id)) {
        s.phase = "play_or_draw";
        s.drawnCardId = id;
        break;
      }
    }
    return null;
  }
  const drawn = drawCards(s, seat, 1, "voluntary", events);
  const card = drawn[0];
  if (card !== undefined && canPlayCard(s, player, card)) {
    s.phase = "play_or_draw";
    s.drawnCardId = card;
  } else {
    advanceTurn(s, seat, 1, events);
  }
  return null;
};

const passTurn: Handler = (s, cmd, events) => {
  const gate = phaseRejection(s);
  if (gate) return gate;
  const seat = seatOf(s, cmd.playerId);
  if (seat !== s.currentSeat) return "NOT_YOUR_TURN";
  if (s.phase === "awaiting_challenge") return "CHALLENGE_PENDING";
  if (s.phase === "awaiting_opening_color" || s.phase === "awaiting_roulette_color") {
    return "COLOR_CHOICE_PENDING";
  }
  if (s.phase === "awaiting_swap_target") return "SWAP_TARGET_PENDING";
  if (s.phase === "facing_penalty") return "MUST_STACK_OR_DRAW";
  if (s.phase === "awaiting_play_or_draw") return "NOTHING_TO_PASS";
  if (isNoMercy(s)) return "MUST_PLAY_DRAWN_CARD";
  closeUnoWindowForOthers(s, cmd.playerId);
  events.push({ type: "TURN_PASSED", playerId: cmd.playerId });
  advanceTurn(s, seat, 1, events);
  return null;
};

const chooseColor: Handler<Extract<Command, { type: "CHOOSE_COLOR" }>> = (s, cmd, events) => {
  if (s.phase !== "awaiting_opening_color" && s.phase !== "awaiting_roulette_color") {
    return "WRONG_PHASE";
  }
  const seat = seatOf(s, cmd.playerId);
  if (seat !== s.currentSeat) return "NOT_YOUR_TURN";
  if (!COLORS.includes(cmd.color)) return "COLOR_INVALID";
  s.activeColor = cmd.color;
  events.push({ type: "COLOR_CHOSEN", playerId: cmd.playerId, color: cmd.color });
  if (s.phase === "awaiting_opening_color") {
    s.phase = "awaiting_play_or_draw";
    return null;
  }

  // Color Roulette: reveal cards one at a time until one of the chosen colour (Wilds never match).
  const player = playerAt(s, seat);
  closeUnoWindowForOthers(s, player.id);
  for (;;) {
    reshuffleIfNeeded(s, events);
    const id = s.drawPile.pop();
    if (id === undefined) break;
    player.hand.push(id);
    player.unoCalled = false;
    clearUnoFor(s, player.id);
    events.push({
      type: "CARDS_DRAWN",
      playerId: player.id,
      count: 1,
      cardIds: [id],
      reason: "color_roulette",
    });
    if (atMercyLimit(s, player)) {
      eliminate(s, seat, events);
      break;
    }
    if (cardDefOf(id).color === cmd.color) break;
  }
  s.colorRouletteActive = null;
  if (handEnded(s)) return null;
  advanceTurn(s, seat, 1, events);
  return null;
};

const chooseSwapTarget: Handler<Extract<Command, { type: "CHOOSE_SWAP_TARGET" }>> = (
  s,
  cmd,
  events,
) => {
  if (s.phase !== "awaiting_swap_target" || !s.swapTargetAwaiting) return "NO_SWAP_PENDING";
  const seat = seatOf(s, cmd.playerId);
  if (seat !== s.currentSeat) return "NOT_YOUR_TURN";
  const targetSeat = typeof cmd.targetId === "string" ? seatOf(s, cmd.targetId) : -1;
  if (targetSeat < 0 || targetSeat === seat || !isActive(s, targetSeat))
    return "INVALID_SWAP_TARGET";
  s.swapTargetAwaiting = null;
  swapHands(s, seat, targetSeat, cmd.at, events);
  advanceTurn(s, seat, 1, events);
  return null;
};

const challenge: Handler = (s, cmd, events) => {
  const pending = s.pendingChallenge;
  if (s.phase !== "awaiting_challenge" || !pending) return "NO_CHALLENGE_PENDING";
  if (pending.targetId !== cmd.playerId) return "NOT_CHALLENGE_TARGET";
  const seat = seatOf(s, cmd.playerId);
  const accusedSeat = seatOf(s, pending.playedById);
  closeUnoWindowForOthers(s, cmd.playerId);
  const success = pending.hadMatchingColor;
  events.push({
    type: "CHALLENGE_RESOLVED",
    challengerId: cmd.playerId,
    accusedId: pending.playedById,
    success,
  });
  s.pendingChallenge = null;
  if (success) {
    drawCards(s, accusedSeat, 4, "challenge_penalty", events);
    advanceTurn(s, seat, 0, events);
  } else {
    drawCards(s, seat, 6, "challenge_failed", events);
    advanceTurn(s, seat, 1, events);
  }
  return null;
};

const callUno: Handler = (s, cmd, events) => {
  if (!isInHand(s)) return "WRONG_PHASE";
  const player = playerAt(s, seatOf(s, cmd.playerId));
  if (player.hand.length !== 1) return "NOT_AT_UNO";
  if (player.unoCalled) return "ALREADY_CALLED_UNO";
  player.unoCalled = true;
  clearUnoFor(s, player.id);
  events.push({ type: "UNO_CALLED", playerId: player.id });
  return null;
};

const catchUno: Handler<Extract<Command, { type: "CATCH_UNO" }>> = (s, cmd, events) => {
  if (!isInHand(s)) return "WRONG_PHASE";
  const targetSeat = seatOf(s, cmd.targetId);
  if (targetSeat < 0) return "UNKNOWN_PLAYER";
  if (cmd.targetId === cmd.playerId) return "CANNOT_CATCH_SELF";
  const target = playerAt(s, targetSeat);
  if (!isActive(s, targetSeat) || target.hand.length !== 1 || target.unoCalled) {
    return "NOTHING_TO_CATCH";
  }
  const w =
    s.unoWindow?.playerId === target.id
      ? s.unoWindow
      : s.unoPending.find((x) => x.playerId === target.id);
  if (!w || cmd.at - w.openedAt > s.config.unoWindowMs) return "UNO_WINDOW_CLOSED";
  events.push({ type: "UNO_CAUGHT", catcherId: cmd.playerId, targetId: target.id });
  clearUnoFor(s, target.id);
  drawCards(s, targetSeat, s.config.unoPenalty, "uno_penalty", events);
  return null;
};

const voteRematch: Handler = (s, cmd, events) => {
  if (s.phase !== "match_over") return "WRONG_PHASE";
  if (s.rematchVotes.includes(cmd.playerId)) return "ALREADY_VOTED";
  s.rematchVotes.push(cmd.playerId);
  events.push({ type: "REMATCH_VOTED", playerId: cmd.playerId });
  const active = s.players.filter((p) => !p.resigned);
  if (active.length >= 2 && active.every((p) => s.rematchVotes.includes(p.id))) {
    for (const p of s.players) {
      p.score = 0;
      p.hand = [];
      p.unoCalled = false;
    }
    s.handNumber = 0;
    s.handResults = [];
    s.summary = null;
    s.matchWinnerId = null;
    s.handWinnerId = null;
    s.rematchVotes = [];
    s.drawPile = [];
    s.discardPile = [];
    s.activeColor = null;
    s.eliminatedPlayerIds = [];
    clearVariantState(s);
    s.phase = "pre_hand";
    s.dealerSeat = stepSeat(s, s.dealerSeat, 1, 1);
    events.push({ type: "REMATCH_AGREED" });
  }
  return null;
};

const resign: Handler = (s, cmd, events) => {
  if (s.phase === "match_over") return "MATCH_OVER";
  const seat = seatOf(s, cmd.playerId);
  const player = playerAt(s, seat);
  const hadTurn = isInHand(s) && seat === s.currentSeat;
  const pending = s.pendingChallenge;

  const returned = player.hand.length;
  s.drawPile.unshift(...player.hand);
  player.hand = [];
  player.resigned = true;
  player.unoCalled = false;
  clearUnoFor(s, player.id);
  s.rematchVotes = s.rematchVotes.filter((id) => id !== player.id);
  events.push({ type: "PLAYER_RESIGNED", playerId: player.id, cardsReturned: returned });

  const remaining = s.players.filter((p) => !p.resigned && !isEliminated(s, p.id));
  if (remaining.length < 2) {
    endMatch(s, remaining[0]?.id ?? null, "forfeit", events);
    return null;
  }
  if (!isInHand(s)) return null;

  if (s.phase === "awaiting_challenge" && pending) {
    if (pending.targetId === player.id) {
      s.pendingChallenge = null;
      advanceTurn(s, seat, 1, events);
    } else if (pending.playedById === player.id) {
      s.pendingChallenge = null;
      s.phase = "awaiting_play_or_draw";
    }
    return null;
  }
  if (hadTurn && s.phase === "awaiting_opening_color") {
    // The colour choice passes to the next player; play has not started yet.
    s.currentSeat = stepSeat(s, seat, s.direction, 1);
    events.push({
      type: "TURN_CHANGED",
      playerId: playerAt(s, s.currentSeat).id,
      direction: s.direction,
    });
    return null;
  }
  if (hadTurn) {
    // Anything the resigner was facing (a stacked penalty, a swap choice, a roulette) is voided.
    s.pendingPenalty = null;
    s.swapTargetAwaiting = null;
    s.colorRouletteActive = null;
    advanceTurn(s, seat, 1, events);
  }
  return null;
};

// ------------------------------------------------------------------ dispatch

const HANDLERS: { [K in Command["type"]]: Handler<Extract<Command, { type: K }>> } = {
  START_HAND: startHandCmd,
  PLAY_CARD: playCard,
  DRAW_CARD: drawCard,
  PASS_TURN: passTurn,
  CHOOSE_COLOR: chooseColor,
  CHOOSE_SWAP_TARGET: chooseSwapTarget,
  CALL_UNO: callUno,
  CATCH_UNO: catchUno,
  CHALLENGE_WILD_DRAW_FOUR: challenge,
  VOTE_REMATCH: voteRematch,
  RESIGN: resign,
  REQUEST_SNAPSHOT: () => null,
};

function rejection(
  state: GameState,
  command: unknown,
  reason: RejectReason,
): { state: GameState; events: EngineEvent[] } {
  const c = (command ?? {}) as Partial<Command>;
  return {
    state,
    events: [
      {
        type: "COMMAND_REJECTED",
        commandId: typeof c.commandId === "string" ? c.commandId : "",
        playerId: typeof c.playerId === "string" ? c.playerId : "",
        commandType: typeof c.type === "string" ? c.type : "",
        reason,
      },
    ],
  };
}

function isWellFormed(command: unknown): command is Command {
  if (typeof command !== "object" || command === null) return false;
  const c = command as Record<string, unknown>;
  return (
    typeof c.type === "string" &&
    c.type in HANDLERS &&
    typeof c.commandId === "string" &&
    c.commandId !== "" &&
    typeof c.playerId === "string" &&
    typeof c.at === "number" &&
    Number.isFinite(c.at)
  );
}

/**
 * Pure transition. On any violation the input state is returned unchanged with exactly one
 * COMMAND_REJECTED event carrying a typed reason code.
 */
export function applyCommand(
  state: GameState,
  command: Command,
): { state: GameState; events: EngineEvent[] } {
  if (!isWellFormed(command)) return rejection(state, command, "MALFORMED_COMMAND");
  if (state.seenCommandIds.includes(command.commandId)) {
    return rejection(state, command, "DUPLICATE_COMMAND");
  }
  const seat = seatOf(state, command.playerId);
  if (seat < 0) return rejection(state, command, "UNKNOWN_PLAYER");
  if (playerAt(state, seat).resigned) return rejection(state, command, "PLAYER_RESIGNED");

  if (command.type === "REQUEST_SNAPSHOT") {
    return { state, events: [{ type: "SNAPSHOT_REQUESTED", playerId: command.playerId }] };
  }
  // Knocked-out players may watch but cannot act until the next hand.
  if (isInHand(state) && isEliminated(state, command.playerId)) {
    return rejection(state, command, "PLAYER_ELIMINATED");
  }

  const draft = clone(state);
  const events: EngineEvent[] = [];
  const handler = HANDLERS[command.type] as Handler;
  const reason = handler(draft, command, events);
  if (reason) return rejection(state, command, reason);
  draft.seenCommandIds.push(command.commandId);
  draft.version += 1;
  return { state: draft, events };
}
