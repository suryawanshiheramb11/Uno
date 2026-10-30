# Architecture

## 1. Topology

```
┌──────────────┐  HTTPS  ┌───────────────────────────────┐
│   Browser    │────────►│  Cloudflare edge              │
│ React + Vite │         │  ├─ Static Assets (SPA, cards)│
│  PWA shell   │◄────────│  └─ Worker  (router / auth)   │
└──────┬───────┘         └──────┬───────────────┬────────┘
       │ WSS                    │ stub.fetch()  │ SQL
       │ /ws/room/ABC123        ▼               ▼
       └──────────────► ┌───────────────┐   ┌───────────┐
                        │ Durable Object│   │    D1     │
                        │  RoomDO       │──►│ accounts, │
                        │ (1 per room)  │   │ matches,  │
                        │ engine + WS   │   │ ratings   │
                        └───────────────┘   └───────────┘
                           storage: DO SQLite (snapshot + command log)
```

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

## 3. Repository layout (created in Phase 1)

```
apps/web         React + Vite client
apps/worker      Worker entry + RoomDO
packages/shared    types/constants (DATA_CONTRACT.md types land here)
packages/engine  pure rules engine (no I/O)
decks/           classic.json, no-mercy.json
scripts/         export-assets, bundle-size, check-contract
docs/
```

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
