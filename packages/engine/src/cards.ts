import { COLORS } from "./types";
import type { Card, CardDef, Face } from "./types";

export const DECK_SIZE = 108;

function buildDefs(): CardDef[] {
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

/** The 108 Classic card definitions, indexed 0..107. */
export const CLASSIC_DEFS: readonly CardDef[] = buildDefs();

/** Card ids are `<handSeed base36>-<deck index>`; the definition is a pure function of the index. */
export function makeCardId(handSeed: number, index: number): string {
  return `${handSeed.toString(36)}-${index}`;
}

export function cardIndex(id: string): number {
  const i = id.lastIndexOf("-");
  const idx = i < 0 ? NaN : Number(id.slice(i + 1));
  if (!Number.isInteger(idx) || idx < 0 || idx >= DECK_SIZE)
    throw new Error(`Invalid card id: ${id}`);
  return idx;
}

export function cardDefOf(id: string): CardDef {
  return CLASSIC_DEFS[cardIndex(id)] as CardDef;
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

/** Scoring value of a card left in a losing hand (docs/GAME_RULES_CLASSIC.md C24). */
export function cardPoints(def: CardDef): number {
  if (def.face === "number") return def.value ?? 0;
  if (def.face === "wild" || def.face === "wild_draw_four") return 50;
  return 20;
}

const FACE_LABEL: Record<Face, string> = {
  number: "",
  skip: "Skip",
  reverse: "Reverse",
  draw_two: "Draw Two",
  wild: "Wild",
  wild_draw_four: "Wild Draw Four",
};

export function cardLabel(id: string): string {
  const d = cardDefOf(id);
  const color = d.color ? d.color[0]!.toUpperCase() + d.color.slice(1) : "";
  const name = d.face === "number" ? String(d.value) : FACE_LABEL[d.face];
  return [color, name].filter(Boolean).join(" ");
}
