# Prediction Tac — Design System (v2 Night Pit)

## Scene
Phone in Telegram at night. Warm charcoal surfaces. Mint signal for conviction. Coral for opposition. Numbers glow just enough to read in one glance.

## Color strategy: Full palette (product data viz)
OKLCH-inspired hex tokens, neutrals tinted toward teal.

| Token | Hex | Role |
|-------|-----|------|
| `--bg` | `#0b1110` | App canvas |
| `--bg2` | `#101816` | Panels / secondary |
| `--card` | `#15201c` | Market surfaces |
| `--card-hi` | `#1a2823` | Hover / elevated |
| `--border` | `rgba(120, 200, 170, 0.10)` | Hairlines |
| `--border-hi` | `rgba(120, 200, 170, 0.22)` | Focus / active |
| `--fg` | `#e7f3ee` | Primary text |
| `--muted` | `#8aa89a` | Secondary |
| `--dim` | `#5d7a6c` | Tertiary |
| `--accent` | `#2ee6a8` | TAC brand / primary CTA |
| `--yes` | `#22d38a` | YES side |
| `--no` | `#ff5c6a` | NO side |
| `--gold` | `#f0c14b` | XP / rank only |
| `--warn` | `#f5a524` | Warnings |

## Typography
- UI: **Plus Jakarta Sans** (friendly product, not crypto-default Space Grotesk)
- Numbers: **JetBrains Mono** with `tabular-nums` for odds, balances, volume
- Scale: 12 / 13 / 14 / 16 / 20 / 28 / 36 (tight product ratios)

## Layout
- Mobile/TG: bottom tab bar (Home, Markets, Vault, You, Rank); slim top chrome
- Desktop: top nav + wider market feed (2-col cards)
- Safe areas: `env(safe-area-inset-*)` on bottom bar and root padding
- Market cards: probability hero (big %), dual trade chips, expand for chart

## Motion
- 160–220ms ease-out (cubic-bezier 0.16, 1, 0.3, 1)
- State only: expand, toast, success pulse, tab switch
- No layout-property animations; no bounce/elastic

## Density
Telegram-first: compact cards, 44px min touch targets, hide non-critical chips under 400px width.
