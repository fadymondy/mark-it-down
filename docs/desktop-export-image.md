# PNG export — code blocks & tables

Mark It Down can snapshot rich content into a PNG using a Carbon-style chrome window over a gradient backdrop. Two surfaces use this today:

- **Code blocks** — right-click a code block in the preview → *Export as PNG*.
- **Data tables** — toolbar export menu (or right-click a table) → *Export as PNG*.

## What you get

```
┌──────────────────────────────────────────────────────┐
│  ←──────── ~96px gradient backdrop ────────►         │
│                                                      │
│        ┌──────────────────────────────┐              │
│        │ ●●●         snippet.ts        │   ← chrome  │
│        ├──────────────────────────────┤              │
│        │                              │              │
│        │     code / table content     │              │
│        │                              │              │
│        └──────────────────────────────┘              │
│                                                      │
└──────────────────────────────────────────────────────┘
```

- The gradient comes from the user's *Code export gradient* setting (Settings → Appearance). Toggle it off to capture without a backdrop — the chrome alone is exported on the app's surface color.
- The chrome window keeps macOS-style traffic-light dots and a centered title pill.
- Filenames are stamped with a unique 8-char id per #238: `code--<id>.png`, `table--<id>.png`.

## Code-block padding (#260)

The export's inner padding is intentionally looser than the live preview:

| Surface         | Padding inside chrome | Backdrop padding |
|-----------------|------------------------|-------------------|
| Live preview    | 16px (compact, terminal feel) | n/a |
| PNG export      | 28px / 24px            | 96px |

The live preview keeps its tighter padding so reading isn't airy. The export deliberately breathes so the screenshot looks like Carbon — generous gradient on all four sides plus a comfortable margin between the chrome border and the first character.

## Table PNG (#261)

The DataTable export menu has a new *Export as PNG* item between *Copy as Markdown* and *Download CSV*. Behavior:

- Snapshots the **filtered + sorted view** the user is looking at.
- Hides the toolbar and pagination footer in the snapshot — the goal is a shareable image of the data, not the controls.
- Removes the scroll cap (`overflow: visible`) so the *entire* visible page is captured even if it would normally be inside a scrollable area.
- Wraps the same chrome window used by code-block exports for visual consistency.

If the table is huge (hundreds of rows), the snapshot can become tall. Filter or paginate first — *Export as PNG* captures whatever's currently rendered.

## Implementation

Both flows live in `apps/electron/renderer/renderer.ts`:

- `exportCodeBlockAsPNG(target)` — preserves the original code-window chrome.
- `exportTableAsPNG(card)` — wraps the DataTable card in a generic `.mid-export-window` chrome before capture.

CSS:
- `.mid-code-export-bg` — backdrop wrapper (gradient + 96px padding).
- `.mid-export-window` — generic chrome shared by tables (and reusable for any future "export X as PNG" surface).
- `.mid-export-window .mid-data-table` — overrides scroll/border/shadow so the snapshot reads as one clean panel.

Both helpers position the temporary capture node off-screen via `transform: translate(-200vw, 0)` rather than `opacity: 0` — html-to-image clones inline styles onto its captured root, so an opacity-hidden wrapper used to produce a fully-transparent PNG (#237).
