# Mark It Down — Design System

One system, five surfaces (VSCode · desktop · web · Chrome · mobile). The rule
that keeps them coherent: **tokens are the only source of visual truth**, and
every surface consumes them — never redefines them.

## Source of truth

| Layer | File | Consumed by |
|---|---|---|
| Color / spacing / radius / type / shadow / motion durations | `packages/ui-tokens/src/tokens.css` | desktop (copied), web (`@mid/tokens`), VSCode webview; mirrored in Flutter as `apps/mobile/lib/theme/tokens.dart` |
| Component primitives (`.mid-btn`, `.mid-surface`, `.mid-list-row`, `.mid-kbd`) | `packages/ui-tokens/src/primitives.css` | desktop, web |
| Icons (curated Boxicons set) | `packages/ui-tokens/src/icons.ts` + `icons.css` | desktop, web, Chrome ext; Material icons approximate on mobile |
| **Motion vocabulary** (keyframes, stagger, skeleton, focus ring) | `packages/ui-tokens/src/animations.css` | desktop, web, Chrome ext; mirrored with Flutter implicit animations |
| The 25 named themes | `packages/core/src/themes/themes.ts` | everywhere — web applies vars, mobile code-gens `themes.g.dart`, desktop/VSCode/Chrome apply palettes |
| Brand mark | `media/brand/icon.svg` | inline SVG (web), CustomPaint (mobile), rasterized `build/icons/*` |

## Palette

Zinc/shadcn-neutral. Light `#fff/#09090b`, dark `#09090b/#fafafa`, sepia, plus
25 named themes that override the same custom properties. The accent is the
fg-tone (`--mid-accent`), links are blue (`--mid-link`). Never hard-code a hex
in app code — always a `--mid-*` var (or `MidPalette` field on mobile).

## Motion

Durations and easings are tokens: `--mid-motion-fast` (120ms) for feedback,
`--mid-motion-base` (200ms) for entrances, `--mid-motion-slow` (320ms) for
large surfaces; `--mid-ease-out` for entering, `--mid-ease-in-out` for moves.

The vocabulary (defined once in `animations.css`):

| Class | Use for |
|---|---|
| `mid-anim-fade-up` | content entering in place — pages, cards, panels |
| `mid-anim-scale-in` | dialogs and popovers |
| `mid-anim-slide-up` | toasts and bottom sheets |
| `mid-stagger` | parent whose children cascade in (60ms steps) |
| `mid-skeleton` | loading placeholders (shimmer) |
| `mid-pressable` | anything clickable — 0.98 scale on press |
| `mid-hover-raise` | cards that lift on hover |

Rules: motion communicates hierarchy, never decorates; one entrance per
navigation, not per element; **always** respect `prefers-reduced-motion`
(the vocabulary already collapses to fades). On Flutter, use
`AnimatedSwitcher`/`AnimatedContainer` with the same durations (120/200/320ms)
and `Curves.easeOutCubic`.

## Interaction states

Every interactive element has all five states: rest, hover (surface tint),
active/press (`mid-pressable`), focus-visible (the shared 2px `--mid-link`
outline from `animations.css`), and disabled (50% opacity). Keyboard access is
not optional — anything mouse-clickable is Tab-reachable.

## Layout idioms

- **App shell**: titlebar (38px) · activity bar (44px) · content · statusbar.
- **Master/detail** for collections (notes): list pane + detail pane; below
  720px it collapses to list → detail with a Back affordance — panes are never
  simply hidden.
- **Settings** are group cards (`.mid-settings-group`): surface header with
  title + description, body of setting rows.
- **Admin** is a separate tab (activity-bar divider), never mixed into the
  everyday workspace.

## Voice

Sentence case everywhere. Empty states say what to do next and offer the
action. Errors say what happened and how to recover — never raw exception text
in front of users (log it, summarize it). Bilingual EN/AR: every user-facing
string ships with both.

## Checklist for new UI (any surface)

1. Colors/spacing/radii from tokens only.
2. States: hover, press, focus-visible, disabled.
3. Entrance motion from the vocabulary; reduced-motion safe.
4. Loading = skeleton (not spinner) when layout is known; empty state with a
   primary action; error state with recovery.
5. Works at 360px wide and at 1440px.
6. EN + AR strings, RTL-checked.
