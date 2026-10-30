import type { Card } from "@uno/engine";

export type BotAction = { type: "play"; cardId: string } | { type: "draw" };

/** Placeholder policy: play the first playable card, else draw. Real bots arrive in Phase 5. */
export function chooseBotAction(hand: Card[], isPlayable: (c: Card) => boolean): BotAction {
  const card = hand.find(isPlayable);
  return card ? { type: "play", cardId: card.id } : { type: "draw" };
}
