/** A deterministic avatar from a seed: the same seed always gives the same colours and letter. */
export function avatarStyle(seed: string): { background: string; letter: string } {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 75% 55%), hsl(${(hue + 50) % 360} 70% 45%))`,
    letter: (seed[0] ?? "?").toUpperCase(),
  };
}

export function Avatar({ seed, size = 64 }: { seed: string; size?: number }) {
  const { background, letter } = avatarStyle(seed);
  return (
    <div
      aria-hidden="true"
      style={{ width: size, height: size, background, fontSize: size * 0.45 }}
      className="flex items-center justify-center rounded-full font-bold text-white"
    >
      {letter}
    </div>
  );
}
