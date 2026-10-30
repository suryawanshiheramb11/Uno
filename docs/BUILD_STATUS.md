# Build Status

Last updated: 2026-10-30. Phase numbering follows the build checklist (0 spec, 1 scaffold + first deploy, 2 Classic engine). Later phases follow `FEATURE_ROADMAP.md`.

| Phase | Name | Status |
|---|---|---|
| 0 | Specification, rulebooks, contracts, asset plan | **Complete** (human sign-off of rulebooks still to record) |
| 1 | Repository scaffold and first deployed website | **Complete in code; staging deploy pending credentials/domain** |
| 2 | Complete Classic rules engine | **Complete** |
| 3 | No Mercy engine | Engine complete (ahead of schedule), UI not started |
| 4+ | Rooms, transport, UI, accounts, bots, social, launch | Not started |

## Phase 0

- [x] `GAME_RULES_CLASSIC.md` (32 decisions), `GAME_RULES_NO_MERCY.md` (30 decisions)
- [x] `DATA_CONTRACT.md`: compiles under `tsc --strict` (`npm run check:contract`); includes field visibility maps, engine reject reasons, PROTOCOL_VERSION = 1
- [x] `ASSET_SPEC.md`: geometry, canonical IDs, full face list, formats, size budget, export command
- [x] `ARCHITECTURE.md`: Browser / Worker / Room, Matchmaker, Presence DOs / D1 diagram, bindings, environments, hibernation
- [x] `FEATURE_ROADMAP.md`: every blueprint feature mapped to a phase
- [x] `BUILD_STATUS.md`, `TEST_PLAN.md`
- [ ] Human review sign-off of the rulebooks
- [ ] Real domains replacing the `example.com` placeholders

## Phase 1

- [x] Workspaces `packages/shared|engine|bots`, `apps/web|worker`; engine has no react / cloudflare / fetch imports
- [x] React + TypeScript + Vite + Tailwind 4 (tokens: palette, spacing, breakpoints, light/dark, font), React Router, `base: "/"`
- [x] Worker: `/api/health`, `/api/protocol`, SPA fallback via Static Assets, `GIT_SHA` injected
- [x] `wrangler.jsonc` with `ASSETS`, `ROOM`, `MATCHMAKER`, `PRESENCE`, `DB` and vars for local / staging / production
- [x] GitHub Actions: lint, typecheck, test, build, deploy staging + smoke test
- [x] `typecheck`, `lint`, `format:check`, `test`, `build`, `deploy:staging` scripts
- [ ] **Blocked on you:** `wrangler deploy --env staging` against a real Cloudflare account, D1 id (`REPLACE_WITH_STAGING_D1_ID`), custom domain, `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets, green Actions run on `main`
- [ ] `wrangler dev` manual check (the Worker test suite covers `/api/health` and `/api/protocol`)

## Phase 2

- [x] `packages/engine/src`: `deck.ts`, `state.ts`, `commands.ts`, `effects.ts`, `snapshots.ts`, `index.ts` (plus `cards.ts`, `rules.ts`, `rng.ts`, `types.ts`)
- [x] Public API: `createInitialState`, `applyCommand`, `getLegalMoves`, `getPlayerView`, `getPublicView`; also `createClassicDeck`, `shuffle`, `deal`
- [x] All Classic commands, effects, UNO window (3 s) and penalty (2), Wild Draw Four challenge, reshuffle, idempotent command ids, typed reject reasons
- [x] `npm run demo:classic` plays a seeded hand to a winner
- [x] 568 engine tests, zero type errors (see `TEST_PLAN.md` for category counts)

## Known deviations from the checklist

1. **Player count is 2-10**, not 2-4. The rulebooks and data contract specify 2-10 (`maxPlayers`). Tell us if you want a hard 4-player cap.
2. **Card file names** are `classic/red-7.svg` (Figma naming) rather than a flat `classic-red-7.svg`. The canonical ID `classic-red-7` maps 1:1, and `node scripts/export-assets.mjs --flat <dir>` writes the flat names.
3. **Card back / table / avatar assets:** backs exist; table textures (WebP) and avatars are specified in `ASSET_SPEC.md` §9 but not yet created.
4. **Bots:** `packages/bots` is a placeholder policy; 4 difficulties land in the bots phase.

## Next phase

Rooms, lobby and WebSocket transport (Room Durable Object wrapping the engine). Not started.
