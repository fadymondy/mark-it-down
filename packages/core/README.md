# @mark-it-down/core

Shared modules consumed by both the VSCode wrapper (`src/`) and the standalone Electron app (`apps/electron/`). No `vscode` API references — pure TypeScript that runs in any Node 18+ or modern browser context.

## Layout

```
packages/core/
├── src/
│   ├── themes/
│   │   ├── index.ts            ← re-export
│   │   └── themes.ts           ← 25 palette definitions + helpers
│   ├── markdown/
│   │   ├── index.ts            ← re-export
│   │   ├── tokens.ts           ← marked.lexer wrapper + inlineToText
│   │   └── renderer.ts         ← marked + highlight.js + mermaid + DOMPurify
│   ├── secrets/
│   │   ├── index.ts
│   │   └── scanner.ts          ← regex set for token detection
│   └── semver/
│       ├── index.ts
│       └── compare.ts          ← parseSemver + compareSemver
└── README.md
```

## Why a directory, not a published package

This is **conceptual modularization**, not an npm package. Files here are imported via relative paths from `src/` and `apps/electron/`. No workspaces, no separate package.json, no build chain bloat. The directory boundary serves as a `vscode`-API firewall: code here may not import `vscode`.

If/when the time comes to publish on npm, promoting this to a real workspace package is mostly cosmetic — add a `package.json` + update the imports.

## What's NOT in core (yet)

These modules touch `vscode.*` and would need an interface abstraction before they can land here:

| Module | Why it stays in `src/` |
|---|---|
| `notes/notesStore.ts` | Uses `workspaceState` + `globalState` |
| `warehouse/*` | Uses `vscode.workspace.fs` + status bar + output channel |
| `publish/*` | Uses git via spawn from the extension's globalStorage |
| `slideshow/*` | Spawns webview panels |
| `mcp/installCommand.ts` | Uses `vscode.window.showQuickPick` |
| `editor/markdownEditorProvider.ts` | Custom editor — pure VSCode |

The Electron wrapper currently re-implements small subsets of these (e.g. file open/save) using its own IPC bridge. A future ship would extract a `Storage` / `FileSystem` / `Picker` interface in core and have both wrappers implement it.

## How to import from core

```ts
// from src/extension.ts (VSCode wrapper)
import { THEMES, paletteToCss } from '../packages/core/src/themes';

// from apps/electron/renderer/renderer.ts (Electron renderer)
import { renderMarkdown } from '../../packages/core/src/markdown/renderer';
```

The relative paths look long but are stable — `packages/core` is a sibling of both `src/` and `apps/`.

## Testing

Tests live in the project's main `tests/` directory and import from `packages/core/src/...`. The vitest config doesn't need any changes — TypeScript resolves relative imports the same way regardless of source file location.
