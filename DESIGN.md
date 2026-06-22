# wattsToCome — Design System

The visual direction is a **data-rich backbone with an "electric" brand skin**: a
serious, data-dense analytical layout that *feels* energetic through styling. Never
sacrifice data density or legibility for decoration.

All colours are defined as CSS custom properties in [`src/index.css`](src/index.css)
`:root`. **Always reference the CSS variable — never hardcode a hex value.** This keeps
new features on-brand and correct under the theme. The app is **locked to the dark
"moody" theme** (a second `:root` overrides the light defaults; `color-scheme: dark`).

## Brand / electric layer (the identity)

| Token | Value | Use |
| --- | --- | --- |
| `--color-accent` | `#185FA5` | Brand blue — primary accent, links, on-track status |
| `--color-accent-light` / `--color-accent-text` | — | Tinted bg / readable text pair |
| `--color-electric` | `#FFD23F` | The logo bolt (yellow). Highlight/marker/border accent — **not** body text on light surfaces (poor contrast) |
| `--color-violet` | `#7C6FF0` | Secondary brand accent |
| `--grad-hero` | `linear-gradient(135deg, #185FA5, #3A3D9E, #6B4FB8)` | Hero header, hot streak, true emphasis moments only |
| `--font-display` | `'Space Grotesk'` | Headings + big numbers |

## Surfaces, text, structure

`--color-bg`, `--color-surface`, `--color-surface2`, `--color-border`,
`--color-border-strong`, `--color-text`, `--color-text-muted`, `--color-text-faint`.
Cards use the `.card` class (surface + `--shadow-card`). Radii: `--radius` (10px),
`--radius-sm` (6px). Shadows: `--shadow-card`, `--shadow-card-hover`.

## Semantic accents

Each has `-light` (background) and `-text` (foreground) variants, flipped for dark theme:
green `#3B6D11`, amber `#854F0B`, red `#A32D2D`, purple `#534AB7`, coral `#993C1D`,
teal `#0F6E56`.

## Training-zone ramp

Cool → warm = easy → hard. Gradients `--zone-z{1..5}-bg` with matching `-fg` text:

| Zone | Meaning | Colour |
| --- | --- | --- |
| z1 | Recovery | teal |
| z2 | Endurance | brand blue |
| z3 | Sweet spot | violet |
| z4 | Threshold | electric yellow |
| z5 | VO₂ | coral |

## Applying it to new features

- Use category accent **spines / borders / icons**, not heavy gradients everywhere.
  Reserve `--grad-hero` for genuine emphasis moments.
- On-brand status tones: success / on-track → `--color-accent` (blue); attention /
  shortfall → `--color-violet` text with `--color-electric` as a marker or border accent.
  Avoid amber/green pastel panels for primary surfaces — they read off-brand against the
  electric skin. (See the coach cards' "site" theme for the canonical example.)
- Inputs use `16px` font on mobile to stop iOS auto-zoom; the hero stacks vertically
  ≤600px. Keep new layouts responsive at that breakpoint.
- Desktop should be **information-dense**: the shell widens to 1120px ≥1000px, and
  secondary card stacks use a two-column grid ≥760px (`.ov-cols`) that collapses to a
  single stacked column below it. Use a grid (stable card position/height), not CSS
  `column-count` masonry, so cards don't reflow as the width changes. Prefer dense
  multi-column desktop layouts for new card-heavy sections rather than one card per row.
- **Widget height standard.** Cards in the same grid row match height automatically (the
  grid stretches them). Give widgets a consistent min-height rhythm with `.wgt-{1,2,3}`
  (`--widget-unit` = 100px): `.wgt-1` for small notes/indicators, `.wgt-2` for cards
  (coach), `.wgt-3` for graphs. Pair like-sized widgets in a row so stretched cards don't
  show large empty space.
