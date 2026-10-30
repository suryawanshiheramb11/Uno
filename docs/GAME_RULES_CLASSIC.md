# Game Rules — Classic

Status: Phase 0 contract. The rules engine (Phase 3) implements exactly this document. Any change here requires a version bump of `rulesVersion` (see DATA_CONTRACT.md).

Rulebook id: `classic` · Deck: 108 cards · Players: 2–10 · Initial hand: 7

## 1. Deck (108 cards)

| Group | Per colour (R/Y/G/B) | Total |
|---|---|---|
| `0` | 1 | 4 |
| `1`–`9` | 2 each | 72 |
| Skip | 2 | 8 |
| Reverse | 2 | 8 |
| Draw Two | 2 | 8 |
| Wild | – | 4 |
| Wild Draw Four | – | 4 |
| **Total** | | **108** |

Invariant tested in Phase 3: `deck.length === 108` and per-id uniqueness (`classic-red-7-a`, `classic-red-7-b`).

## 2. Setup

1. Shuffle with the room's seeded RNG (seed stored in the match record so games are replayable).
2. Deal 7 cards to each player, one at a time starting left of the dealer.
3. Flip the top of the draw pile to start the discard pile (see §6 for non-number starters).
4. First player is left of the dealer; direction starts clockwise (increasing seat index).

## 3. Turn state machine

```
                      ┌─────────────────────────────────────────┐
                      ▼                                         │
 [awaiting_play_or_draw] ──play card──► [effect_resolution] ──► [next_turn] ──┐
        │   ▲                                 ▲                      │        │
        │   │ (drawn card                     │                      │        │
        │   │  is playable)                   │                      ▼        │
        └─draw──► [play_or_draw] ──play drawn─┘            [awaiting_play_or_draw]
                        │                                  (next seat)        │
                        └────pass───────────► [next_turn] ───────────────────┘

 Side states:  [awaiting_color]   (Wild played, colour not yet supplied — folded into the play command, never persisted)
               [awaiting_challenge] (target of Wild Draw Four may challenge)
               [round_over]  [match_over]  [abandoned]
```

| State | Who may act | Legal commands | Leaves via |
|---|---|---|---|
| `awaiting_play_or_draw` | current player | `play_card`, `draw_card` | play → `effect_resolution`; draw → `play_or_draw` |
| `play_or_draw` | current player (just drew one card) | `play_card` (only the drawn card), `pass_turn` | play → `effect_resolution`; pass → `next_turn` |
| `awaiting_challenge` | target of Wild Draw Four | `challenge`, `accept` (or timeout = accept) | resolved → `next_turn` |
| `effect_resolution` | server only | none | → `next_turn` or `round_over` |
| `next_turn` | server only | none | → `awaiting_play_or_draw` |

Out-of-band commands legal in any non-terminal state: `call_uno`, `catch_uno`, `chat`, `leave`.

## 4. Card behaviour

A card is playable if it matches the **active colour** or the **top card's value/symbol**, or is a Wild.

| Card | Effect |
|---|---|
| Number 0–9 | None. |
| Skip | Next player loses their turn. |
| Reverse | Direction flips. With 2 players it acts as Skip (same player goes again). |
| Draw Two | Next player draws 2 and loses their turn. Not stackable (variant flag `stackDrawTwo`, default off). |
| Wild | Player names the active colour. Command must carry `chosenColor`. |
| Wild Draw Four | Player names the colour; next player may challenge (§5), else draws 4 and loses their turn. |

Active colour = colour of the top card, or the named colour after a Wild.

## 5. Resolved ambiguities

Every row is a binding decision. IDs are referenced by engine tests (`rule-C01` …).

| ID | Question | Decision |
|---|---|---|
| C01 | Opening card is Wild Draw Four | Return it to the draw pile, reshuffle, flip again. Repeat until the starter is not a Wild Draw Four. |
| C02 | Opening card is plain Wild | First player names the colour and plays normally. |
| C03 | Opening card is Skip | First player is skipped; the seat after them plays first. |
| C04 | Opening card is Reverse | Direction becomes counter-clockwise and the dealer plays first, for any player count (with 2 players this equals Skip). Implemented and tested in Phase 2. |
| C05 | Opening card is Draw Two | First player draws 2 and loses their turn. |
| C06 | Two-player Reverse | Behaves as Skip; the player who played it plays again. |
| C07 | Two-player Skip | Same player plays again. |
| C08 | Wild Draw Four legality | Playable when the active colour is not in hand *by colour only* (matching number/symbol of another colour does not make it illegal). The server **permits** a bluff: it plays but is flagged `challengeable` iff the hand held a card of the active colour at play time. Variant `strictWildDrawFour` (default off) rejects illegal plays instead and disables challenges. |
| C09 | Who may challenge | Only the target of the Wild Draw Four, only before they draw or take any other action. |
| C10 | Challenge window | The engine has no clock: `awaiting_challenge` lasts until the target acts. Declining is `DRAW_CARD` (draws 4). The room server enforces the 10 000 ms timeout by submitting `DRAW_CARD` for the target. *(Phase 2.)* |
| C11 | Challenge succeeds (play was illegal) | Player who played draws 4; challenger draws nothing and **does not lose their turn** — play passes normally from the challenger. The Wild's chosen colour is **kept** as active colour. |
| C12 | Challenge fails (play was legal) | Challenger draws 6 (4 + 2) and loses their turn. |
| C13 | UNO call | A player with exactly 1 card must have called UNO. Calling is allowed as a flag on the play command (`callUno: true`, only valid when the play leaves 1 card) or as a standalone `call_uno` while holding 1 card. |
| C14 | UNO catch window | Opens when a play leaves the hand at 1 card. **3 000 ms** (`unoWindowMs`, inclusive at the boundary), and it also closes as soon as any other player takes a turn action (play, draw, pass or challenge). Any other player may `CATCH_UNO` inside it; the engine measures time from the command's `at` timestamp. *(Phase 2: was 5 000 ms.)* |
| C15 | UNO penalty | 2 cards. Applied once per offence; the penalised player is then marked safe. |
| C16 | UNO flag resets | When the hand grows to 2+ cards, `unoCalled` is cleared. |
| C17 | May a drawn card be played immediately | Yes. After a single draw the player may play that card (and only that card) or pass. |
| C18 | May a player draw when holding a playable card | Yes (modern rules). They draw exactly one card. |
| C19 | Draw pile empties | Keep the top discard; shuffle the rest (seeded RNG, continuing the match PRNG stream) into a new draw pile. If still empty (all cards in hands), the draw yields nothing and the turn passes. |
| C20 | Forced draws (Draw Two, Wild Draw Four, penalties) with a short pile | Reshuffle as C19, then give as many as exist. |
| C21 | Last card is an action card | The play wins the round immediately; its effect (e.g. Draw Two) still resolves so the drawn cards are in the victim's hand for scoring. |
| C22 | Last card is Wild / Wild Draw Four | Colour is irrelevant; no challenge is offered; round ends. |
| C23 | Jump-in (out-of-turn identical card) | Not supported in Classic v1 (`jumpIn` variant flag reserved, default off). |
| C24 | Winning hand scoring | Winner scores the sum of all opponents' remaining cards: number = face value, Skip/Reverse/Draw Two = 20, Wild/Wild Draw Four = 50. |
| C25 | Match end | `matchMode: "single_round"` (default) ends after one round. `matchMode: "points_500"` repeats rounds until a player reaches 500. |
| C26 | Player disconnects mid-action | Seat is held for 60 000 ms. The turn timer keeps running. On expiry the engine auto-acts (below). Reconnecting inside the window restores control. |
| C27 | Turn timer expiry auto-action | No pending choice: draw one card; if playable and it is a non-Wild, non-challenge play it is **not** auto-played; pass. Pending challenge: accept. Pending colour choice does not exist as a state (colour is part of the play). |
| C28 | Consecutive timeouts | After 3 consecutive timeouts a player is marked `forfeited`: their hand is placed at the bottom of the draw pile (shuffled in at next reshuffle), they are skipped, and a bot plays no cards for them. |
| C29 | Every human times out / disconnects | If no connected human remains for 120 000 ms the match becomes `abandoned`: no winner, no scores recorded, room closed. If exactly one connected human remains they win by forfeit (`reason: "forfeit"`). |
| C30 | Playing after the round ended | Rejected with `ERR_ROUND_OVER`. |
| C31 | Invalid command | Rejected with an error event to the sender only; state is unchanged and no turn time is consumed. |
| C32 | Command idempotency | Every command carries a client `commandId`; duplicates within the match are ignored and re-acked. |

## 6. Round termination and scoring detail

1. A round ends the moment a player's hand reaches 0 after effect resolution.
2. Scores computed per C24; stored in `MatchSummary.rounds[]`.
3. In `points_500`, the next round starts after 8 000 ms with the previous winner as first dealer's left.

## 7. Variant flags (Classic)

| Flag | Default | Notes |
|---|---|---|
| `stackDrawTwo` | false | Draw Two on Draw Two; Wild Draw Four never stacks. |
| `strictWildDrawFour` | false | See C08. |
| `jumpIn` | false | Reserved. |
| `matchMode` | `single_round` | See C25. |
| `turnTimerMs` | 30 000 | 10 000–120 000, or `null` for no timer (private rooms only). |

## 8. Implementation notes (Phase 2)

- Commands are `START_HAND, PLAY_CARD, DRAW_CARD, PASS_TURN, CHOOSE_COLOR, CALL_UNO, CATCH_UNO, CHALLENGE_WILD_DRAW_FOUR, VOTE_REMATCH, RESIGN, REQUEST_SNAPSHOT`. `PASS_TURN` is an addition to the brief: after drawing a playable card the player must be able to keep it.
- `CHOOSE_COLOR` is only used for an opening Wild; a Wild played from hand carries its colour in `PLAY_CARD`.
- Phases: `pre_hand, awaiting_opening_color, awaiting_play_or_draw, play_or_draw, awaiting_challenge, hand_over, match_over`.
- Every rejection returns the state unchanged plus one `COMMAND_REJECTED` event with a typed `RejectReason`.
- The engine's own types (`packages/engine/src/types.ts`) supersede the Phase 0 drafts in DATA_CONTRACT.md where they differ.
- Resign: the hand goes to the bottom of the draw pile; a pending challenge involving the resigner is voided; with fewer than two players left the match ends by forfeit.

## 9. Engine test matrix (Phase 2 gate)

Each decision C01–C32 gets at least one deterministic scenario test using a fixed seed. Phase 3 does not exit until all pass.
