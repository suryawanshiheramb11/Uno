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
| N08 | Draw Until You Can Play | Player with no playable card draws until a playable one appears. That card **must** be played (player supplies target/colour parameters, 30 s timer). If it is a stackable draw card it starts a new stack (no pending one exists). Voluntary draws when a playable card exists are **illegal**. |
| N09 | Draw pile empties mid-draw | Reshuffle: top discard stays; all other discards **plus all set-aside eliminated hands** are shuffled into a new draw pile; draw continues. If still empty, the draw stops: Draw-Until-Play ends with the turn passing; Roulette ends and takes what was revealed; stack penalty gives what exists. |
| N10 | 7-swap at high hand size | Swap is atomic. Hand sizes are exchanged. The mercy check runs afterward, so the player who *receives* ≥ 25 cards is eliminated immediately. A player already at ≥ 25 cannot exist (they would already be out). |
| N11 | Swap with an eliminated player / when swap is the last card | Eliminated targets are not selectable. If the 7 is the player's **last** card, they win; no swap occurs. If only one opponent is active, the target is auto-selected. |
| N12 | When is Mercy checked? | After each atomic action's effects complete (play, penalty absorption, Roulette, swap, 0-rotation), never mid-draw. Threshold is **≥ 25**. |
| N13 | Simultaneous eliminations | All players with ≥ 25 are eliminated together (possible via 0 rotation or swap). If that would eliminate **everyone**, the player with the fewest cards (ties: first in seat order from the actor) survives and wins. |
| N14 | Swapped-out player and UNO | Any player left holding exactly 1 card after a swap/rotation is "at UNO". They must call UNO; the catch window opens at that moment with the same rules as Classic (C14): closes when the next turn begins or after 5 000 ms. Penalty 2 cards. |
| N15 | UNO penalty amount | 2 cards. |
| N16 | Elimination and stacking | Eliminated players leave turn order and cannot be stack targets. Elimination only occurs after resolution (N12), so no stack is pending on an eliminated seat; the next target is computed from the surviving seats. |
| N17 | Eliminated hand | Set aside face-down (still counted in the table total). Returns to the pool at the next reshuffle (N09). Never discarded permanently. |
| N18 | Last player standing | When one non-eliminated player remains, they win immediately with `reason: "last_standing"`. |
| N19 | Discard All timing | Playable on matching colour/number/symbol like any coloured card. After play, all other cards of that colour in hand go under it (order preserved). If this empties the hand, the player wins. Cards under it are not hidden from the reshuffle. |
| N20 | Skip Everyone with a pending stack | Not playable (N02). Otherwise the same player acts again; in a 2-player game it equals Skip. |
| N21 | 0-pass with eliminated seats | Hands rotate among active seats only. |
| N22 | 0 as last card | Round ends; no rotation. |
| N23 | Challenging | There is no challenge mechanic in No Mercy; all wild plays are always legal. |
| N24 | Scoring | Winner receives the sum of opponents' remaining hands: number = face, coloured action (Skip, Reverse, +2, +4, Discard All, Skip Everyone) = 20, wild action (WRD4, WD6, WD10, Roulette) = 50. Eliminated players' hands are ignored. Plus **250 per knockout** achieved during the round. First to 1 000 wins the match (`matchMode: "points_1000"`); default `single_round` awards just the round win. |
| N25 | Knockout credit | Credited to the player whose action caused the elimination (play, stack, swap, rotation). For self-inflicted elimination (draw penalty), no credit. |
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

## 7. Engine test matrix

Each of N01–N30 has a seeded scenario test. Additionally: property tests for card conservation (total cards in hands + draw + discard + set-aside is always 168) and for `rulesVersion` replay determinism.
