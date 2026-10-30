#!/usr/bin/env node
// Syncs generated card SVGs into the web app and prints a manifest with the total size.
//   node scripts/export-assets.mjs                 -> tools/figma-cards/public/cards -> apps/web/src/assets/cards
//   node scripts/export-assets.mjs --flat <dir>    -> additionally write flat canonical names (classic-red-7.svg)
import { cpSync, mkdirSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "tools/figma-cards/public/cards");
const dest = join(root, "apps/web/src/assets/cards");
const flatIdx = process.argv.indexOf("--flat");
const flatDir = flatIdx > -1 ? process.argv[flatIdx + 1] : null;

cpSync(src, dest, { recursive: true });
let total = 0;
let count = 0;
for (const edition of readdirSync(dest)) {
  const dir = join(dest, edition);
  if (!statSync(dir).isDirectory()) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".svg"))) {
    const size = statSync(join(dir, file)).size;
    total += size;
    count += 1;
    if (flatDir) {
      mkdirSync(flatDir, { recursive: true });
      copyFileSync(join(dir, file), join(flatDir, `${edition}-${file}`));
    }
  }
}
const budget = 8 * 1024 * 1024;
console.log(
  `${count} card SVGs, ${(total / 1024 / 1024).toFixed(2)} MB (budget ${budget / 1024 / 1024} MB)`,
);
if (total > budget) {
  console.error("Card bundle exceeds budget");
  process.exit(1);
}
