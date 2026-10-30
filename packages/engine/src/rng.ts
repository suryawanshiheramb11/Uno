/** Injected randomness source. `next()` returns a float in [0, 1). */
export interface Rng {
  next(): number;
}

export type RngState = [number, number, number, number];

function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** xoshiro128** step. Mutates `s`; returns a uint32. */
export function nextUint32(s: RngState): number {
  const rotl = (x: number, k: number) => (x << k) | (x >>> (32 - k));
  const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
  const t = s[1] << 9;
  s[2] ^= s[0];
  s[3] ^= s[1];
  s[1] ^= s[2];
  s[0] ^= s[3];
  s[2] ^= t;
  s[3] = rotl(s[3], 11);
  s[0] >>>= 0;
  s[1] >>>= 0;
  s[2] >>>= 0;
  s[3] >>>= 0;
  return result;
}

/** Deterministic seeded Rng for tests, demos and replays. Production passes a crypto-backed Rng. */
export function createRng(seed: number | string): Rng {
  const mix = splitmix32(typeof seed === "string" ? hashString(seed) : seed);
  const state: RngState = [mix(), mix(), mix(), mix()];
  if (state.every((x) => x === 0)) state[0] = 1;
  return { next: () => nextUint32(state) / 4294967296 };
}

export function seedRngState(rng: Rng): RngState {
  const word = () => Math.floor(rng.next() * 4294967296) >>> 0;
  const state: RngState = [word(), word(), word(), word()];
  if (state.every((x) => x === 0)) state[0] = 1;
  return state;
}

export function shuffleInPlace<T>(arr: T[], state: RngState): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor((nextUint32(state) / 4294967296) * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
}
