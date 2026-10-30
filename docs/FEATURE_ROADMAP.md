# Feature Roadmap

Status values: `done` · `in progress` · `planned`. Update this table at the end of every phase.

Phase map: **0** specification · **1** scaffold + deploy pipeline + assets · **2** rooms, lobby, WebSocket transport · **3** rules engine + gameplay UI · **4** accounts, Google OAuth, D1 history · **5** polish: bots, public lobby, spectators, sound/animation · **6** replays, ratings, leaderboards.

> Phases 1–6 are the working allocation inferred from the Phase 0 deliverables (OAuth in Phase 4 is fixed by the brief). Adjust if the later phase briefs differ.

| # | Feature | Phase | Status |
|---|---|---|---|
| 1 | Classic rulebook written, 15+ ambiguities resolved | 0 | done |
| 2 | No Mercy rulebook written, all listed ambiguities resolved | 0 | done |
| 3 | Data contract types (compile-checked) | 0 | done |
| 4 | Protocol version + clean rejection of old clients | 0 (spec) / 2 (impl) | done (spec) |
| 5 | HTTP route table + WebSocket schema | 0 (spec) / 2 (impl) | done (spec) |
| 6 | Asset spec: names, geometry, reproducible Figma export | 0 (spec) / 1 (script) | done (spec) |
| 7 | Architecture + environments + domains chosen | 0 | done |
| 8 | Domain registration (staging + production) | before 4 | planned |
| 9 | Monorepo scaffold, CI, lint, tests | 1 | done |
| 10 | Staging + production deployment on Cloudflare custom domains | 1 | in progress (config + CI ready; awaiting real domain/credentials) |
| 11 | Figma card faces exported, bundled, size budget tracked | 1 | planned |
| 12 | Static Assets hosting of deck/tables/avatars | 1 | in progress (Static Assets wired; no deck yet) |
| 13 | Guest sessions | 2 | planned |
| 14 | Create / join room by code | 2 | planned |
| 15 | Room lobby: ready, variant settings, host controls, kick | 2 | planned |
| 16 | Durable Object room with hibernatable WebSockets | 2 | planned |
| 17 | Reconnect and resync (`resumeFromVersion`) | 2 | planned |
| 18 | Chat | 2 | planned |
| 19 | Classic rules engine (C01–C32) | 2 | done (297 tests; server-side clock/timeouts come with the room, Phase 3) |
| 20 | No Mercy rules engine (N01–N30) | 3 | planned |
| 21 | Seeded shuffle + deterministic replays | 2 | done (engine); replay viewer later |
| 22 | Table UI: hand, piles, direction, active colour | 3 | planned |
| 23 | Colour picker, 7-swap target picker, Roulette picker | 3 | planned |
| 24 | UNO call + catch window UI | 3 | planned |
| 25 | Wild Draw Four challenge UI | 3 | planned |
| 26 | Penalty stack UI (No Mercy) | 3 | planned |
| 27 | Mercy elimination UI | 3 | planned |
| 28 | Turn timers, disconnect handling, forfeits, abandoned matches | 3 | planned |
| 29 | Scoring and multi-round matches | 3 | planned |
| 30 | Google OAuth login (registered redirect URIs) | 4 | planned |
| 31 | D1 schema: players, sessions, matches | 4 | planned |
| 32 | Profile, avatar, match history | 4 | planned |
| 33 | Guest → account upgrade | 4 | planned |
| 34 | Bots (easy/normal/hard) | 5 | planned |
| 35 | Public room listing + quick match | 5 | planned |
| 36 | Spectators | 5 | planned |
| 37 | Card, deal, and victory animations; sound | 5 | planned |
| 38 | Colour-blind mode, keyboard play, reduced motion | 5 | planned |
| 39 | Mobile layout and PWA install | 5 | planned |
| 40 | Match replays from seed + command log | 6 | planned |
| 41 | Ratings and leaderboards per rulebook | 6 | planned |
| 42 | Bundle size history and regression gate | 1 (gate) / every release | planned |
| 43 | Rate limiting and abuse protection | 2 | planned |
| 44 | Observability and health endpoint | 1 | in progress (health endpoint done) |

## Phase 0 exit checklist

- [x] Six documents exist under `docs/`
- [x] Classic: 32 decisions (≥15 required), all items from the brief covered
- [x] No Mercy: 30 decisions, all items from the brief covered
- [x] `scripts/check-contract.sh` compiles the contract under `tsc --strict`
- [x] Asset export is a single reproducible command (spec)
- [ ] Human review of the two rulebooks (especially deck counts in No Mercy §1, N05, N14)
- [ ] Real domains chosen to replace `example.com`
