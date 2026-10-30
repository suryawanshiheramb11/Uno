import { cardLabel } from "../src/index";
import type { EngineEvent } from "../src/index";

const labels = (ids: string[] | undefined) => (ids ?? []).map(cardLabel).join(", ");

/**
 * One human-readable line for an event (or null to stay quiet). This is an omniscient reviewer's log:
 * it names cards that real players would not see. `prev` is the preceding event, used to avoid repeating
 * a Wild's colour that the play line already announced.
 */
export function describeEvent(e: EngineEvent, prev: EngineEvent | undefined): string | null {
  switch (e.type) {
    case "HAND_STARTED":
      return `Hand ${e.handNumber} dealt. Dealer ${e.dealerId}; ${e.firstPlayerId} is first.`;
    case "OPENING_CARD_RESHUFFLED":
      return `Opening card was ${cardLabel(e.cardId)}: set aside, turning up another.`;
    case "OPENING_CARD":
      return `Opening card: ${cardLabel(e.cardId)}`;
    case "CARD_PLAYED":
      return `${e.playerId} plays ${cardLabel(e.cardId)}${e.chosenColor ? ` and calls ${e.chosenColor}` : ""}`;
    case "CARDS_DISCARDED":
      return `   ${e.playerId} also discards ${e.cardIds.length}: ${labels(e.cardIds)}`;
    case "CARDS_DRAWN": {
      const why = e.reason.replace(/_/g, " ");
      if (e.count === 0) return `${e.playerId} draws nothing (${why}): the pile is empty`;
      const detail = e.count <= 4 ? ` [${labels(e.cardIds)}]` : "";
      return `${e.playerId} draws ${e.count} (${why})${detail}`;
    }
    case "PENALTY_PENDING":
      return `   ${e.playerId} faces +${e.total} (stack ${e.topValue}+ to pass it on, or draw)`;
    case "TURN_CHANGED":
      return `   -> ${e.playerId}'s turn (${e.direction === 1 ? "clockwise" : "counter-clockwise"})`;
    case "TURN_PASSED":
      return `${e.playerId} keeps the drawn card and passes`;
    case "DIRECTION_REVERSED":
      return `Direction reverses`;
    case "PLAYER_SKIPPED":
      return `${e.playerId} is skipped (${e.reason.replace(/_/g, " ")})`;
    case "COLOR_CHOSEN":
      return prev?.type === "CARD_PLAYED" && prev.chosenColor === e.color
        ? null
        : `${e.playerId} chooses ${e.color}`;
    case "SWAP_TARGET_REQUESTED":
      return `${e.playerId} must pick someone to swap hands with`;
    case "HANDS_SWAPPED":
      return `${e.a} and ${e.b} swap hands`;
    case "HANDS_ROTATED": {
      const d = Object.entries(e.deltas)
        .map(([id, n]) => `${id} ${n >= 0 ? "+" : ""}${n}`)
        .join(", ");
      return `Every hand is passed ${e.direction === 1 ? "clockwise" : "counter-clockwise"} (card change: ${d})`;
    }
    case "ROULETTE_STARTED":
      return `${e.targetId} must name a colour and reveal cards until one matches`;
    case "PLAYER_ELIMINATED":
      return `*** ${e.playerId} is ELIMINATED with ${e.cardsReturned} cards; their hand is shuffled back into the pile`;
    case "UNO_CALLED":
      return `${e.playerId} calls UNO!`;
    case "UNO_CAUGHT":
      return `${e.catcherId} catches ${e.targetId} without UNO!`;
    case "CHALLENGE_RESOLVED":
      return `${e.challengerId} challenges ${e.accusedId}: ${e.success ? "SUCCESS, the bluff is exposed" : "FAILED, the play was legal"}`;
    case "CHALLENGE_DECLINED":
      return `${e.playerId} declines to challenge`;
    case "DRAW_PILE_RESHUFFLED":
      return `Draw pile empty: reshuffled ${e.cardCount} cards from the discard pile`;
    case "PLAYER_RESIGNED":
      return `${e.playerId} resigns`;
    case "HAND_WON": {
      const scores = Object.entries(e.scores)
        .map(([id, s]) => `${id} ${s}`)
        .join(", ");
      return `*** ${e.winnerId} WINS THE HAND for ${e.points} points (${scores})`;
    }
    case "MATCH_ENDED":
      return `Match over: ${e.summary.winnerId} (${e.summary.endReason}). Placements: ${e.summary.players.map((p) => `${p.placement}. ${p.id}`).join(", ")}`;
    case "COMMAND_REJECTED":
      return `!! REJECTED ${e.commandType} from ${e.playerId}: ${e.reason}`;
    default:
      return null;
  }
}
