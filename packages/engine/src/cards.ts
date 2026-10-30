import type { Variant } from "@uno/shared";
import { COLORS } from "./types";
import type { Card, CardDef, Face } from "./types";

export const DECK_SIZE = 108;
export const NM_DECK_SIZE = 168;

export function deckSizeOf(variant: Variant): number {
  return variant === "no_mercy" ? NM_DECK_SIZE : DECK_SIZE;
}

function buildClassicDefs(): CardDef[] {
  const defs: CardDef[] = [];
  for (const color of COLORS) {
    defs.push({ color, face: "number", value: 0 });
    for (let n = 1; n <= 9; n++) {
      defs.push({ color, face: "number", value: n }, { color, face: "number", value: n });
    }
    for (const face of ["skip", "reverse", "draw_two"] as const) {
      defs.push({ color, face, value: null }, { color, face, value: null });
    }
  }
  for (let i = 0; i < 4; i++) defs.push({ color: null, face: "wild", value: null });
  for (let i = 0; i < 4; i++) defs.push({ color: null, face: "wild_draw_four", value: null });
  return defs;
}

/** Per colour: 0-9 twice, 3 Skip, 3 Reverse, 3 Draw Two, 2 Draw Four, 3 Discard All, 2 Skip Everyone (36). */
const NM_COLORED: ReadonlyArray<readonly [Face, number]> = [
  ["skip", 3],
  ["reverse", 3],
  ["draw_two", 3],
  ["draw_four", 2],
  ["discard_all", 3],
  ["skip_everyone", 2],
];
const NM_WILDS: readonly Face[] = [
  "wild_reverse_draw_four",
  "wild_draw_six",
  "wild_draw_ten",
  "wild_color_roulette",
];

function buildNoMercyDefs(): CardDef[] {
  const defs: CardDef[] = [];
  for (const color of COLORS) {
    for (let n = 0; n <= 9; n++) {
      defs.push({ color, face: "number", value: n }, { color, face: "number", value: n });
    }
    for (const [face, copies] of NM_COLORED) {
      for (let i = 0; i < copies; i++) defs.push({ color, face, value: null });
    }
  }
  for (const face of NM_WILDS)
    for (let i = 0; i < 6; i++) defs.push({ color: null, face, value: null });
  return defs;
}

/** The 108 Classic card definitions, indexed 0..107. */
export const CLASSIC_DEFS: readonly CardDef[] = buildClassicDefs();
/** The 168 No Mercy card definitions, indexed 0..167. */
export const NO_MERCY_DEFS: readonly CardDef[] = buildNoMercyDefs();

export function defsFor(variant: Variant): readonly CardDef[] {
  return variant === "no_mercy" ? NO_MERCY_DEFS : CLASSIC_DEFS;
}

/**
 * Card ids are `<handSeed base36>-<deck index>`; No Mercy ids carry a leading capital `N`
 * (base-36 seeds are lowercase, so the two never collide). The definition is a pure function of the id.
 */
export function makeCardId(handSeed: number, index: number, variant: Variant = "classic"): string {
  return `${variant === "no_mercy" ? "N" : ""}${handSeed.toString(36)}-${index}`;
}

export function variantOfCardId(id: string): Variant {
  return id.startsWith("N") ? "no_mercy" : "classic";
}

export function cardIndex(id: string): number {
  const i = id.lastIndexOf("-");
  const idx = i < 0 ? NaN : Number(id.slice(i + 1));
  const size = deckSizeOf(variantOfCardId(id));
  if (!Number.isInteger(idx) || idx < 0 || idx >= size) throw new Error(`Invalid card id: ${id}`);
  return idx;
}

export function cardDefOf(id: string): CardDef {
  return defsFor(variantOfCardId(id))[cardIndex(id)] as CardDef;
}

export function cardOf(id: string): Card {
  return { id, ...cardDefOf(id) };
}

export function isValidCardId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  try {
    cardIndex(id);
    return true;
  } catch {
    return false;
  }
}

/** Cards that add to a No Mercy penalty stack, with their stack value. */
export function drawValue(def: CardDef): number {
  switch (def.face) {
    case "draw_two":
      return 2;
    case "draw_four":
    case "wild_reverse_draw_four":
      return 4;
    case "wild_draw_six":
      return 6;
    case "wild_draw_ten":
      return 10;
    default:
      return 0;
  }
}

/** Scoring value of a card left in a losing hand (GAME_RULES_CLASSIC C24 / GAME_RULES_NO_MERCY N24). */
export function cardPoints(def: CardDef): number {
  if (def.face === "number") return def.value ?? 0;
  if (def.color === null) return 50;
  return 20;
}

const FACE_LABEL: Record<Face, string> = {
  number: "",
  skip: "Skip",
  reverse: "Reverse",
  draw_two: "Draw Two",
  wild: "Wild",
  wild_draw_four: "Wild Draw Four",
  draw_four: "Draw Four",
  discard_all: "Discard All",
  skip_everyone: "Skip Everyone",
  wild_reverse_draw_four: "Wild Reverse Draw Four",
  wild_draw_six: "Wild Draw Six",
  wild_draw_ten: "Wild Draw Ten",
  wild_color_roulette: "Wild Color Roulette",
};

export function cardLabel(id: string): string {
  const d = cardDefOf(id);
  const color = d.color ? d.color[0]!.toUpperCase() + d.color.slice(1) : "";
  const name = d.face === "number" ? String(d.value) : FACE_LABEL[d.face];
  return [color, name].filter(Boolean).join(" ");
}
