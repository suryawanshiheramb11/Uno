# Architecture

## 1. Topology

**Everything is served from Cloudflare.** Static assets, the API, WebSockets and storage all run on the Cloudflare network (Workers + Static Assets + Durable Objects + D1). There is no separate CDN and no origin server.

```
┌──────────────┐  HTTPS  ┌──────────────────────────────────────┐
│   Browser    │────────►│  Cloudflare edge                     │
│ React + Vite │         │  ├─ Static Assets  (binding ASSETS)  │
│  PWA shell   │◄────────│  └─ Worker  (router / auth / API)    │
└──────┬───────┘         └───┬──────────┬──────────┬────────┬───┘
       │ WSS                 │          │          │        │ SQL
       │ /ws/room/ABC123     ▼          ▼          ▼        ▼
       └──────────────► ┌─────────┐ ┌───────────┐ ┌──────────┐ ┌────────┐
                        │ Room DO │ │Matchmaker │ │Presence  │ │   D1   │
                        │ (ROOM)  │ │DO         │ │DO        │ │ (DB)   │
                        │ 1/room  │ │(MATCHMAKER│ │(PRESENCE)│ │accounts│
                        │ engine+ │ │ queues,   │ │ friends  │ │matches │
                        │ sockets │ │ ranked)   │ │ online)  │ │ratings │
                        └────┬────┘ └─────┬─────┘ └──────────┘ └────────┘
                             │ creates room│                        ▲
                             └─────────────┘   match end write ──────┘
                        storage: each DO's own SQLite (snapshot + command log)
```

Browser ↔ Worker ↔ Room DO ↔ D1, with the Matchmaker DO (pairs players, allocates room codes) and the Presence DO (online status, friends, invites) beside them.

### 1.1 Worker bindings

| Binding | Type | Purpose |
|---|---|---|
| `ASSETS` | Static Assets | SPA, card SVGs, textures; SPA fallback |
| `ROOM` | Durable Object namespace (`Room`) | One authoritative game room |
| `MATCHMAKER` | Durable Object namespace (`Matchmaker`) | Quick / ranked queues |
| `PRESENCE` | Durable Object namespace (`Presence`) | Presence, friends, invites |
| `DB` | D1 database | Accounts, match history, ratings |

Plain vars: `ENVIRONMENT`, `APP_URL`, `PROTOCOL_VERSION`, `GIT_SHA`.

### 1.2 Durable Object hibernation and SQLite persistence

- Room DOs use the **WebSocket Hibernation API** (`ctx.acceptWebSocket`, `webSocketMessage`, `webSocketClose`). An idle room with open sockets is evicted from memory and its connections stay open at the edge; the next message re-instantiates the DO, which then rebuilds state from storage. Idle rooms cost nothing.
- Because a DO can be evicted at any time, no state lives only in memory: after every accepted command the DO writes the new `GameState` snapshot and appends the command to its log in **DO SQLite storage** (classes are declared with `new_sqlite_classes` in the migration). Per-socket data lives in `serializeAttachment`.
- Timers (turn deadline, UNO window, reconnect grace) use **DO alarms**, not `setTimeout`, so they survive hibernation.
- D1 is written only when a match ends (`MatchSummary` + command log), keeping it off the hot path.

## 2. What runs where

| Concern | Location | Reason |
|---|---|---|
| UI rendering, animations, optimistic hints | Browser | Clients never decide legality; they only pre-highlight from `PrivateSnapshot.playableCardIds` |
| Static files, SPA fallback | Cloudflare Static Assets | Cheap, cached at the edge |
| HTTP routing, session validation, rate limiting, OAuth | Worker | Stateless, fast |
| Game rules engine (pure TypeScript, `packages/engine`) | Inside `RoomDO`; also unit-tested in Node | One authoritative state machine per room; deterministic given seed |
| WebSocket fan-out, turn timers, reconnect grace | `RoomDO` (hibernatable WebSockets, DO alarms) | Single-threaded per room → no race conditions |
| In-flight game state | DO storage (snapshot every command + append command log) | Survives eviction/deploy |
| Accounts, sessions, match history, ratings, leaderboards | D1 | Relational queries across rooms |
| Finished-match write | `RoomDO` → D1 at `match_over` (retry with backoff via alarm) | Keeps D1 off the hot path |

Hidden-information rule: the DO builds `PublicSnapshot` and a per-seat `PrivateSnapshot`; nothing else ever leaves the DO. Spectators receive the public snapshot only.

## 3. Repository layout (Phase 1, as built)

```
apps/web         React 19 + Vite + Tailwind 4 + React Router client
apps/worker      Worker entry (/api/*), Room / Matchmaker / Presence DO classes
packages/shared  protocol constants + shared types
packages/engine  pure rules engine (no I/O): deck, state, commands, effects, snapshots
packages/bots    bot strategies (depends on engine + shared only)
scripts/         export-assets, check-contract
tools/figma-cards  vendored card generator
docs/
```

### Tooling actually used

| Tool | Version / syntax |
|---|---|
| Wrangler | 4.x, `wrangler.jsonc` (JSONC), `compatibility_date` `2026-10-01`, flag `nodejs_compat` |
| Assets | `"assets": { "directory": "../web/dist", "binding": "ASSETS", "not_found_handling": "single-page-application", "run_worker_first": ["/api/*"] }` |
| DOs | `"durable_objects": { "bindings": [...] }` + `"migrations": [{ "tag": "v1", "new_sqlite_classes": [...] }]` |
| Environments | top level = local; `env.staging`, `env.production` repeat every binding (Wrangler does not inherit them) |
| Deploy | `npm run deploy:staging` → `wrangler deploy --env staging --var GIT_SHA:<sha>` |
| Node / TS / Vitest | Node ≥ 20 (`.nvmrc`), TypeScript 5.9, Vitest 4 |

## 4. Request flows

1. **Create room:** `POST /api/rooms` → Worker validates session → `env.ROOM.idFromName(code)` → DO initialises lobby → returns code.
2. **Join/play:** browser opens WSS → Worker authenticates the token, forwards the upgrade to the DO → DO sends `welcome` + snapshots → commands flow as `command` envelopes.
3. **Turn timer:** DO alarm at `turnDeadlineMs`; fires auto-action per rules docs (C27, N27).
4. **Match end:** DO writes `MatchSummary` and command log to D1, broadcasts `match_over`, schedules room teardown after 10 min.

## 5. Environments and deployment model

| Env | Domain | Worker name | D1 | Purpose |
|---|---|---|---|---|
| local | `http://localhost:5173` (Vite) + `wrangler dev` on `:8787` | `uno-local` | local SQLite | Development, Miniflare DOs |
| staging | **`staging.uno.example.com`** | `uno-staging` | `uno-staging` | Every merge to `main`; OAuth test client; used for e2e |
| production | **`uno.example.com`** | `uno-prod` | `uno-prod` | Manually promoted from a green staging build |

- Both domains are real Cloudflare zones/custom domains (not `workers.dev`) because OAuth needs registered redirect URIs: `https://staging.uno.example.com/auth/google/callback` and `https://uno.example.com/auth/google/callback` (plus `http://localhost:8787/auth/google/callback` for local). **Register both domains and both OAuth clients before Phase 4 starts.** `example.com` is a placeholder; swap in the owned domain in one place (`wrangler.jsonc` vars + `docs`).
- Pipeline: PR → typecheck, unit/engine tests, `assets-check`, `check-contract` → merge → deploy staging → Playwright e2e against staging → manual `promote` workflow → production.
- Secrets (`GOOGLE_CLIENT_SECRET`, `SESSION_SIGNING_KEY`, `FIGMA_TOKEN`) live in Wrangler secrets / CI secrets, one set per environment.
- D1 migrations are forward-only and applied by CI before the Worker deploy.
- DO class changes use Wrangler migrations tags; protocol bumps follow DATA_CONTRACT.md §1 with at least one staging soak.

## 6. Cross-cutting

- **Determinism:** seeded PRNG (xoshiro128**) state is part of `GameState`; same seed + command log ⇒ identical match (replays, bug repro).
- **Observability:** structured logs with `matchId`, `roomCode`; Workers Analytics; DO exceptions surfaced to a `/api/health` counter.
- **Security:** token auth on WS upgrade, origin check, per-socket rate limits, server-side legality validation, no hand data in public channel.
- **Capacity assumption:** ≤ 10 players + spectators per room; a DO comfortably holds that.
