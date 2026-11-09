# Pick helper UX measurements

Measured on a 1440×900 desktop by driving the real UI in headless Chromium over CDP. Each mouse click or key press counts as one action. Typed characters are not counted.
Layout shift was measured with the Layout Instability API (`layout-shift`).

## Actions per scenario

| # | Scenario | Before | Now | How |
| --- | --- | --- | --- | --- |
| T1 | Enter 5 enemies (role queue) | 10 (5 popovers) | **5** | Click 5 heroes in the input grid, or name + Enter ×5. The role picks the slot |
| T2 | Swap the enemy tank | 2 | **1** | The tank slot is unique, so clicking the new hero replaces it |
| T3 | Swap an enemy damage/support | 2 | 2 (no popover) | New hero → click the flashing slot to replace |
| T4 | Enter 4 bans | 1 tab switch + 8 | **4** | Click suggested chips in the ban row |
| T5 | Next match, same party | 1 + 2–6 to rebuild the party | **1** | "New match" keeps party, roles and settings (the map resets) |
| T6 | Add an unregistered friend as support | 7+n, 2 page changes | **3** | Add member → name → support |
| T7 | Take a recommended hero | 1 | 1 | |
| T8 | See ban suggestions during the ban phase | 1 | **0** | In the ban phase, the recommendation tab and input target switch to bans automatically |
| – | Undo a mistake | 2 (reopen and clear) | **1** | Ctrl+Z or "Undo" |

## Scrolling and layout shift

- **1440×900**: the page is exactly one screen tall (`scrollHeight` 900).
  - The input grid and the recommendations are visible together without scrolling. Before, the input popover covered the recommendations.
  - Long recommendation lists scroll inside their own panel.
- **Layout shift in the input area**: under 0.003 in total across all scenarios above, and only horizontal shifts as suggestion chips change width.
  - Recommendation cards changing is a data update, so it is excluded from the measurement.
- **390px mobile**:
  - No horizontal scroll.
  - Tapping a slot scrolls to the input grid without opening the keyboard.

## Duplicates removed

| Function | Before | Now |
| --- | --- | --- |
| Placing people | Party bar role buttons + person chips in slot popovers | Party bar only |
| Auto role | Global "auto-assign roles" switch + open-queue "Auto" button | Per-person "Auto" button (both queues) |
| Clearing | Per-team "Clear" + slot popover "Clear" + "New match" | Slot × + "New match" (+ undo) |
| Entering bans | Ban slot popovers + "Mark banned" in the ban tab | Ban row suggestion chips / input grid "Bans" target (ban tab kept) |

## Impossible states blocked

- **Role queue**: a team can never exceed its role slots.
  - The tank is replaced directly.
  - For damage/support, you pick which slot to replace.
- **Same hero twice on a team**: a second click removes the hero instead.
- **Heroes disabled in the input grid**, with the reason in a tooltip:
  - a banned hero for a team
  - a picked hero for bans
  - all ban slots used
  - the ban limit for that role reached
  - a full open-queue team
  - a role that doesn't match the selected slot
- **Queue switch**: heroes that no longer fit are removed, with a notice and undo.
- **Quick Play**: no ban target and no ban row. Bans are kept and restored when you switch back to Competitive.
