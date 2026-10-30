# Test Plan

Runner: Vitest 4 (`npm test`). Every engine test asserts both the resulting state and the emitted events. Counts below are for the current tree.

## Phase 1: scaffold

| Category | Location | Tests |
|---|---|---|
| Engine smoke / deck | `packages/engine/src/deck.test.ts` | 15 |
| Worker (`/api/health`, `/api/protocol`, fallthrough) | `apps/worker/test` | 6 |
| React render (landing page) | `apps/web/src/Landing.test.tsx` | 4 |
| Shared / bots | `packages/*/src` | 2 (bots) + 49 (shared) |
| Contract compile | `npm run check:contract` | CI step |
| Gates | typecheck, lint, format:check, build (size warnings) | CI |

## Phase 2: Classic engine (requires ≥ 120, ≥ 10-20 per category)

| Category | Required | File(s) | Tests |
|---|---|---|---|
| Deck integrity | 10+ | `deck.test.ts`, `construction.test.ts` | 15 + 27 |
| Shuffle determinism / deal | yes | `deck.test.ts`, `determinism.test.ts` | 8 + 43 |
| Basic play and draw | 15+ | `play-draw.test.ts` | 23 |
| Action cards | 20+ | `actions.test.ts` | 24 |
| Wild / Wild Draw Four / challenge | 20+ | `wild-draw-four.test.ts` | 23 |
| UNO window and penalty | 15+ | `uno.test.ts` | 28 |
| Opening card edge cases | 10+ | `opening.test.ts` | 20 |
| Two-player Reverse / Skip | 10+ | `two-player.test.ts` | 11 |
| Win condition and hand end | 10+ | `hand-end.test.ts` | 16 |
| Invalid-move rejection | 10+ | `rejection.test.ts` | 32 |
| Resign, rematch, reshuffle | n/a | `resign-rematch-reshuffle.test.ts` | 25 |
| Snapshot leak (no foreign hands) | yes | `views.test.ts` | 20 |
| Determinism (seed + commands ⇒ identical JSON) | yes | `determinism.test.ts` (snapshot) | included |
| Fuzz / conservation of cards | yes | `fuzz-helpers.ts`, `nm-games.test.ts` | included |

Engine total: **568** (Classic ≥ 297, No Mercy ≥ 253, deck API 15).

## Phase 3 (No Mercy engine)

Stacking, WRD4, Draw-Until-Play, Roulette + elimination, 7-swap / 0-rotate, Discard All / Skip Everyone, full seeded games: `nm-*.test.ts`.

## Later phases (planned)

| Phase | Categories |
|---|---|
| Rooms / transport | Room DO command ordering, idempotency, reconnect + `resumeFromVersion`, hibernation recovery, protocol-version rejection, rate limits (Workers vitest pool) |
| UI | component tests per table element, keyboard play, colour-blind mode; Playwright e2e (`e2e/`) against staging |
| Accounts / D1 | migration tests, OAuth callback with mocked Google, session expiry |
| Bots | each difficulty finishes 1 000 seeded games with no illegal move; difficulty ordering by win rate |
| Matchmaking / ranked | queue pairing, ELO math properties, leaderboard queries |
| Social | friends / blocking / reporting authorization, presence expiry |
| Replays | seed + command log reproduces final state byte-for-byte |
| Accessibility / i18n | axe checks, string table completeness |
| Security / load | fuzzed WS frames, origin checks, k6 load of rooms / matchmaker |
