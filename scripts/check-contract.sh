#!/usr/bin/env bash
# Extracts every ```ts block from docs/DATA_CONTRACT.md and type-checks it in strict mode.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
awk '/^```ts$/{f=1;next} /^```$/{f=0} f' "$ROOT/docs/DATA_CONTRACT.md" > "$OUT/contract.ts"
npx --yes -p typescript@5 tsc --noEmit --strict --target ES2022 --module ESNext --skipLibCheck "$OUT/contract.ts"
echo "DATA_CONTRACT.md: types compile ($(wc -l < "$OUT/contract.ts") lines)"
