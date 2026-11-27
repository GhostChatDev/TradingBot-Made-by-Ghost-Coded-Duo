# DESIGN.md — Solana trading bot demo

Non-custodial: the user's own wallet signs everything. Paper and devnet only in this build.

## Who it is for and what the screen is for
Someone who wants to try a Solana bot with their own wallet, see every decision it makes,
and stop it instantly. One action per screen; nothing on screen promises a return.

## Visual direction
A calm instrument panel, not a casino. Flat surfaces, thin borders, one signal colour used
only for state (green = running, amber = blocked by a limit, red = stopped). No gradients,
no glass cards, no glow.

## Colour tokens
| token | hex | use |
|---|---|---|
| `--bg` | `#0f1216` | page background |
| `--surface` | `#171b21` | cards, panels |
| `--border` | `#252b34` | 1px separators |
| `--text` | `#e6e9ee` | body text (13.6:1 on `--bg`) |
| `--muted` | `#98a1ae` | labels, secondary text (5.1:1 on `--bg`) |
| `--accent` | `#4c8dff` | primary action, links |
| `--success` | `#38b27a` | running, filled, inside limits |
| `--warn` | `#e0a83a` | blocked by a cap |
| `--danger` | `#e5533d` | STOP, stopped, errors |

## Type
One stack: `ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`.
Body 15px / 1.55. Small 13px for labels. Headings 20px and 26px, weight 600.
All figures (prices, balances, credits) use `font-variant-numeric: tabular-nums`.

## Space and shape
Spacing scale: 4, 8, 12, 16, 24, 32 px. Radii: 8px for controls, 12px for cards.
Card padding 16px, border 1px `--border`. Never more than 3 columns of cards.

## Components
- App shell: top bar with mode badge + wallet state, left nav on wide screens,
  bottom bar under 900px.
- `Button` primary / secondary / danger, min height 44px, visible focus ring (`--accent` 2px offset 2px).
- `Card` with a title row and a body.
- `ModeSwitch` segmented control: Paper | Devnet. Mainnet shows as a disabled chip reading "Off".
- `StatBlock` big number, small caption, tabular figures.
- `LogList` newest first, kind chip, timestamp, reason text.
- `KeyRow` label, prefix, created, last used, Revoke.
- `Banner` for the disclaimer, always visible on every screen with trading on it.
- `EmptyState`, `LoadingState`, `ErrorState` for each data panel.

## Non-negotiables on screen
Every trading screen shows: "General information and software, not financial advice.
You can lose everything you put in." Mainnet and real payments are always labelled Off.
Paper prices are labelled "simulated" wherever a number from them appears.

## Responsive
390 / 768 / 1440 px. Single column on phone, nav becomes a bottom bar, no sideways scroll,
44px touch targets, tables become stacked rows.
