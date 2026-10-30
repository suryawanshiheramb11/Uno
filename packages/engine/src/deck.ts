import type { Variant } from "@uno/shared";
import { cardOf, deckSizeOf, makeCardId } from "./cards";
import type { Card } from "./types";

/** Full ordered (unshuffled) deck of card ids for a variant; ids derive from `seed` + deck index. */
export function createDeckIds(variant: Variant, seed: number): string[] {
  return Array.from({ length: deckSizeOf(variant) }, (_, i) => makeCardId(seed, i, variant));
}

/** The 108 Classic cards in canonical order, each with a unique id of the form `<seed>-<index>`. */
export function createClassicDeck(seed = 0): Card[] {
  return createDeckIds("classic", seed).map(cardOf);
}

/** The 168 No Mercy cards in canonical order. */
export function createNoMercyDeck(seed = 0): Card[] {
  return createDeckIds("no_mercy", seed).map(cardOf);
}

/** Fisher-Yates shuffle with an injected `rng: () => number` in [0, 1). Returns a new array. */
export function shuffle<T>(deck: readonly T[], rng: () => number): T[] {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/** Deals `handSize` cards to each player round-robin from the top (front) of the deck. */
export function deal<T>(
  deck: readonly T[],
  playerCount: number,
  handSize: number,
): { hands: T[][]; drawPile: T[] } {
  if (
    !Number.isInteger(playerCount) ||
    playerCount < 1 ||
    !Number.isInteger(handSize) ||
    handSize < 0
  ) {
    throw new RangeError("deal: playerCount and handSize must be non-negative integers");
  }
  if (playerCount * handSize > deck.length) throw new RangeError("deal: not enough cards");
  const hands: T[][] = Array.from({ length: playerCount }, () => []);
  for (let round = 0; round < handSize; round++) {
    for (let p = 0; p < playerCount; p++) {
      (hands[p] as T[]).push(deck[round * playerCount + p] as T);
    }
  }
  return { hands, drawPile: deck.slice(playerCount * handSize) };
}
