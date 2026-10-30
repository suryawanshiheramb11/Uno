# Game Rules — UNO Show 'Em No Mercy

Status: Phase 0 contract. Source of truth is the official rule sheet plus the decisions below. Where the sheet is silent, the NM decision wins.

Rulebook id: `no_mercy` · Deck: 168 cards · Players: 2–10 · Initial hand: 7

## 1. Deck (168 cards)

Composition is data, not code (`decks/no-mercy.json`). The counts below make the official 168 total; **verify against the physical deck before Phase 3 and adjust the manifest only** — a unit test asserts `total === 168`.

| Group | Per colour | ×4 colours |
|---|---|---|
| Numbers 0–9 (two each) | 20 | 80 |
| Skip | 3 | 12 |
| Reverse | 3 | 12 |
| Draw Two (+2) | 3 | 12 |
| Draw Four (+4) | 2 | 8 |
| Discard All | 3 | 12 |
| Skip Everyone | 2 | 8 |
| **Coloured subtotal** | **36** | **144** |
| Wild Reverse Draw Four | – | 6 |
| Wild Draw Six | – | 6 |
| Wild Draw Ten | – | 6 |
| Wild Color Roulette | – | 6 |
| **Wild subtotal** | | **24** |
| **Total** | | **168** |

Stack values: `+2 = 2`, `+4 = 4`, `Wild Reverse Draw Four = 4`, `Wild Draw Six = 6`, `Wild Draw Ten = 10`.

## 2. Setup

1. Seeded shuffle, deal 7 each.
2. Flip cards until a **number card** appears; action/wild cards revealed are returned to the bottom of the draw pile (official: "ignore it and flip the next card"). So no opening effect rules are needed.
3. Player left of the dealer starts; clockwise.

## 3. Turn state machine

```
 [awaiting_play_or_draw] ──play──► [effect_resolution] ──► [mercy_check] ──► [next_turn]
        │                              ▲   │                                    │
        │ no legal card                │   └─► [awaiting_roulette_color]        │
        └─► [drawing_until_playable] ──┘       (target picks colour)              │
                                                                                ▼
 [facing_penalty] (stack pending) ──stack──► [effect_resolution]   [awaiting_play_or_draw]
        └─ cannot / will not stack ─► [absorbing_penalty] ─► [mercy_check] ─► [next_turn]
```

| State | Actor | Legal commands |
|---|---|---|
| `awaiting_play_or_draw` | current | `play_card`; `draw_card` **only if no card in hand is playable** |
| `drawing_until_playable` | server | draws one at a time; stops at first playable card, who must then be played (§5 N08) |
| `facing_penalty` | stack target | `play_card` (draw card of value ≥ top), or `draw_card` (take the whole stack) |
| `awaiting_roulette_color` | roulette target | `choose_color` |
| `mercy_check` | server | eliminates any player with ≥ 25 cards |
| `next_turn` | server | advances to next non-eliminated seat |

## 4. Card behaviour

Playable = matches active colour, number, or symbol; wilds always playable **except** while a penalty stack is pending (§5 N02).

| Card | Effect |
|---|---|
| Number | none, except **7** and **0** |
| 0 | All players pass their hands one seat in the current direction. Eliminated seats skipped. |
| 7 | Player **must** swap hands with a chosen active opponent; play continues in current order. |
| Skip | Next player loses turn. |
| Reverse | Direction flips; 2 players: acts as Skip. |
| +2 / +4 | Starts or extends a penalty stack. Next player lose turn if they take it. |
| Discard All | Play it plus every other card in hand of the same colour. The extras go **under** it; the Discard All stays on top. |
| Skip Everyone | All other players are skipped; same player takes another turn. |
| Wild Reverse Draw Four | Reverse, then next player in new direction faces +4. 2 players: the playing player is the target (§5 N05). |
| Wild Draw Six / Ten | Player names colour; next player faces +6 / +10. |
| Wild Color Roulette | Target names a colour (becomes active colour), then reveals from the draw pile until a card of that colour (wilds excluded) appears, takes all revealed cards, loses turn. |

## 5. Resolved ambiguities

| ID | Question | Decision |
|---|---|---|
| N01 | Stack: equal or strictly greater? | **Equal or greater** (per sheet). `+4` onto `+4` ok; `+6` onto `+6` ok; `+4` onto `+6` rejected. |
| N02 | What may be played while a penalty is pending? | Only stackable draw cards: `+2, +4, WRD4, WD6, WD10`, each with value ≥ the top card's value. Nothing else, including Roulette, Skip, Reverse, Skip Everyone, Discard All, 0, 7. Colour match is **not** required for stacking. |
| N03 | May `+2` stack onto `+4`? | **No** (2 < 4). Default `allowLowerStack: false`. Variant flag reserved. |
| N04 | Does the pending stack have a cap? | No. Total may exceed the deck; draws give what exists (N14). |
| N05 | Wild Reverse Draw Four semantics | Direction flips on play. Contributes **4** to the stack and counts as value 4 for N01. Stack passes in the *new* direction. **Two players:** reverse = skip, so the target is the **player themself**; they may immediately stack `+4/WRD4/+6/WD6/+10/WD10` from hand to send it to the opponent, otherwise draw the stack and lose their turn (opponent then plays). |
| N06 | Colour after a stacked wild | The wild's player-chosen colour is the active colour; a coloured draw card sets its own colour. |
| N07 | Wild Color Roulette: counting and mercy | Every revealed card (including the matching one) is added to the hand. Mercy is checked **after** the whole reveal completes (N12), so a long reveal can eliminate the target. Colour choice is by the *target*; active colour becomes their choice and stays. |
| N08 | Draw Until You Can Play | A player with no playable card draws one card at a time (one `CARDS_DRAWN` event per card, reason `draw_until_play`) until a playable one appears. That card becomes the **only legal move** and must be played (no pass). Drawing is **illegal** while any card in hand is playable (`CANNOT_DRAW_WITH_PLAYABLE`). |
| N09 | Draw pile empties mid-draw | Reshuffle: the top discard stays; every other discard is shuffled into a new draw pile (eliminated hands are already back in the pile, N17); drawing continues. If still empty, the draw stops: Draw-Until-Play and Roulette end with what was drawn and the turn passes; a stack gives what exists. |
| N10 | 7-swap at high hand size | Moot: a hand can never reach the mercy limit without its owner being eliminated at once (N12), so every live hand is below it and a swap only exchanges two such hands. No special case is needed or implemented. |
| N11 | 7 with one opponent / as the last card | The 7-player **always** chooses the target with `CHOOSE_SWAP_TARGET`, even with a single opponent. Eliminated and resigned players are not valid (`INVALID_SWAP_TARGET`). A 7 played as the **last card** wins the hand and no swap happens (so no player is ever swapped an empty hand). |
| N12 | When is Mercy checked? | **After every card that is added to a hand** (penalty draws, Draw-Until-Play, Roulette, UNO penalty). The moment a hand reaches the threshold (default 25) the owner is eliminated and that draw stops mid-way. *(Phase 3: was "after the whole action".)* |
| N13 | Simultaneous eliminations | Moot for the same reason as N10: swaps and rotations only move existing hands, and a draw eliminates one player at a time. |
| N14 | Swapped/rotated player and UNO | Anyone left on exactly one card by a swap or rotation gets a UNO window (`unoPending`, 3 000 ms from the command's timestamp) and their called-UNO flag is reset. Anyone else may `CATCH_UNO` them for the usual 2-card penalty; they save themselves with `CALL_UNO`. The next player's turn action closes everyone else's window. |
| N15 | UNO penalty amount | 2 cards. |
| N16 | Elimination and stacking | Eliminated players leave turn order and cannot be stack targets. Elimination only occurs after resolution (N12), so no stack is pending on an eliminated seat; the next target is computed from the surviving seats. |
| N17 | Eliminated hand | **Shuffled back into the draw pile immediately** (the whole pile is reshuffled with the match PRNG). *(Phase 3: was "set aside until the next reshuffle".)* |
| N18 | Last player standing | When one non-eliminated player remains, they win immediately with `reason: "last_standing"`. |
| N19 | Discard All timing | Playable on matching colour/number/symbol like any coloured card. After play, all other cards of that colour in hand go under it (order preserved). If this empties the hand, the player wins. Cards under it are not hidden from the reshuffle. |
| N20 | Skip Everyone with a pending stack | Not playable (N02). Otherwise the same player acts again; in a 2-player game it equals Skip. |
| N21 | 0-pass with eliminated seats | Hands rotate among active seats only. |
| N22 | 0 as last card | Round ends; no rotation. |
| N23 | Challenging | There is no challenge mechanic in No Mercy; all wild plays are always legal. |
| N24 | Scoring | Winner receives the sum of opponents' remaining hands: number = face, coloured action (Skip, Reverse, +2, +4, Discard All, Skip Everyone) = 20, wild action (WRD4, WD6, WD10, Roulette) = 50. Eliminated players' hands are empty and score nothing. Plus **250 for each player eliminated during the hand**, paid to the winner. First to `targetScore` (e.g. 1 000) wins a multi-hand match; the default is a single hand. |
| N25 | Knockout bonus | Paid to the hand's **winner** for every player eliminated that hand, whoever caused it (this follows the printed rule). *(Phase 3: was "credited to the causing player".)* |
| N26 | Disconnect, timeouts, all-timeout | Same as Classic C26–C29. A forfeited player's hand is set aside as an eliminated hand (N17) and they count as eliminated without knockout credit. |
| N27 | Turn timer expiry auto-actions | Facing penalty: absorb it. No-playable state: draw-until-play auto-plays the first legal card using the smallest-value legal option; wild colours default to the most common colour in hand. Roulette colour: most common colour in hand. |
| N28 | Opening card | Always a number card (§2). |
| N29 | Number 7 effect on a pending stack | Not playable (N02). |
| N30 | Reshuffle PRNG | Continues the match PRNG stream so replays are exact. |

## 6. Variant flags (No Mercy)

| Flag | Default |
|---|---|
| `allowLowerStack` | false |
| `sevenZeroRules` | true |
| `mercyThreshold` | 25 |
| `matchMode` | `single_round` |
| `turnTimerMs` | 30 000 |

## 7. Implementation notes (Phase 3)

- One engine, two variants: `createInitialState("no_mercy", ...)`. Variant-specific state fields (`pendingPenalty`, `eliminatedPlayerIds`, `swapTargetAwaiting`, `colorRouletteActive`, `unoPending`) are `null` / empty in Classic; turn advance, win check, scoring, UNO and the views are shared.
- New phases: `facing_penalty`, `awaiting_swap_target`, `awaiting_roulette_color`. New command: `CHOOSE_SWAP_TARGET`. `CHOOSE_COLOR` is also how a Roulette target names their colour.
- New typed rejections: `STACK_TOO_LOW`, `MUST_STACK_OR_DRAW`, `CANNOT_DRAW_WITH_PLAYABLE`, `MUST_PLAY_DRAWN_CARD`, `SWAP_TARGET_PENDING`, `NO_SWAP_PENDING`, `INVALID_SWAP_TARGET`, `PLAYER_ELIMINATED`.
- Card ids carry an `N` prefix (`N<seed>-<index>`); Classic ids are unchanged.
- Wild Color Roulette: the target names a colour (it becomes the active colour), then reveals one card at a time until one of that colour (Wilds never match), keeping every card, then loses their turn. The revealed cards are public. A Roulette played as the last card wins immediately with no effect.
- Wild Reverse Draw Four stacks as value 4 and reverses direction each time it is played. With two players the reverse acts as a skip, so the player who played it faces the penalty (and may stack it back); each further Reverse Draw Four lands on them again.
- A penalty card played as the last card wins the hand; the next player draws the whole stack first so it counts in scoring.
- Discard All sets the active colour to its own colour, discards every other card of that colour underneath it, and wins if that empties the hand.
- Resigning while facing a penalty, a swap choice or a roulette voids it and passes the turn.
- Opening card: always a number; an action or Wild turned up is put on the bottom of the pile.

## 8. Engine test matrix

Each of N01–N30 has a seeded scenario test. Additionally: property tests for card conservation (total cards in hands + draw + discard + set-aside is always 168) and for `rulesVersion` replay determinism.
