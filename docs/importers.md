# Importer plugin system

> Status: shipped in #246. First-party importers (Apple Notes, Google Keep,
> Notion, generic markdown) land in #247–#250 on top of this contract.

Mark It Down imports notes from external apps via a tiny plugin contract. Adding
a new importer is a matter of dropping one folder under
`apps/electron/importers/<id>/` — no changes to the core renderer, main process,
loader, or chooser modal are required.

## What ships in this issue

- `apps/electron/importers/types.ts` — the `Importer` contract, plus
  `ImporterMetadata`, `ImportedNote`, `ImportContext`, `ImportedAttachment`, and
  the `isImporter` type guard.
- `apps/electron/importers/loader.ts` — discovers `index.js` (compiled) or
  `index.ts` (dev) under each `apps/electron/importers/<id>/` folder, validates
  the default export, and registers it in an in-memory map.
- `apps/electron/importers/sample/index.ts` — the smoke-test importer that
  yields one hardcoded markdown note. Deleting this folder leaves the system
  with zero importers and the chooser shows an empty-state message.
- IPC surface in `apps/electron/main.ts`:
  - `mid:importers-list` returns metadata only (no functions).
  - `mid:importers-run` starts a streaming import.
  - `mid:importers-progress`, `mid:importers-done`, `mid:importers-error`,
    `mid:importers-log` push events back to the renderer.
- Renderer surface in `apps/electron/renderer/renderer.ts` (and matching CSS in
  `renderer.css`):
  - "Import from…" button injected at the bottom of the activity bar.
  - "Import from…" entry in the **File** menu (sends `mid:menu-import`).
  - Modal dialog that lists registered importers, runs the chosen one, and
    streams progress lines as notes hit disk.

## The contract

Every importer module under `apps/electron/importers/<id>/index.ts` default-
exports an object satisfying:

```ts
export interface Importer extends ImporterMetadata {
  detect?(input: string): Promise<boolean>;
  import(input: string, ctx: ImportContext): AsyncIterable<ImportedNote>;
}

export interface ImporterMetadata {
  id: string;                       // kebab-case, unique
  name: string;                     // display name
  icon: string;                     // boxicons name (e.g. "bx-import")
  supportedFormats?: string[];      // e.g. ["folder", "zip"]
  description?: string;             // short blurb shown in the chooser
}

export interface ImportedNote {
  title: string;
  body: string;                     // markdown body (no frontmatter — host adds it)
  tags?: string[];
  createdAt?: string;               // ISO 8601
  updatedAt?: string;               // ISO 8601
  attachments?: ImportedAttachment[];
  meta?: Record<string, unknown>;   // extra frontmatter fields
}

export interface ImportedAttachment {
  name: string;                     // filename relative to the attachments folder
  data: Buffer;
  mime?: string;
}

export interface ImportContext {
  workspaceFolder: string;          // absolute path to the workspace root
  log: (msg: string) => void;       // pipes into the main-process logger
  signal?: AbortSignal;
}
```

The contract intentionally returns an `AsyncIterable<ImportedNote>` instead of
buffering everything: the host writes each note to disk as it arrives, so a
giant Notion export doesn't sit in memory.

## How the host uses an importer

1. **Discovery** (one-shot at app startup): `loadImporters()` reads every
   subdirectory of `apps/electron/importers/`, requires the first available
   `index.js` or `index.ts`, validates the default export with `isImporter`,
   and registers it. Failures and duplicate ids are logged and skipped — they
   never crash the app. The startup log prints
   `[importers] registered: id-a, id-b, …`.
2. **Listing** (per renderer request): `mid:importers-list` strips the
   `detect`/`import` functions and returns the metadata array.
3. **Running** (per chooser click):
   - Renderer calls `mid:importers-run(importerId, input, workspaceFolder)`.
   - Main process resolves the importer, creates
     `<workspace>/Imported/<importer-id>/`, and invokes `import(input, ctx)`.
   - For each yielded note, the host:
     - Sanitises the title into a filename.
     - Writes a markdown file with frontmatter (`created`, `updated`, `tags`,
       any keys from `note.meta`).
     - If `note.attachments` is non-empty, writes each attachment under
       `Imported/<id>/attachments/<sanitised-title>/`.
     - Sends `mid:importers-progress` to the renderer with the running count.
   - On completion, `mid:importers-done` fires with the final count; on failure
     `mid:importers-error` carries the message.

## Adding a new importer

1. Create a folder: `apps/electron/importers/my-importer/`.
2. Add `index.ts` whose default export satisfies `Importer`:

   ```ts
   import { Importer, ImportedNote, ImportContext } from '../types';

   const myImporter: Importer = {
     id: 'my-importer',
     name: 'My App',
     icon: 'bx-import',
     supportedFormats: ['folder'],
     description: 'Imports notes from My App.',

     async detect(input) {
       // Cheap probe — return true if this folder/file looks like My App.
       return false;
     },

     async *import(input, ctx) {
       ctx.log(`[my-importer] scanning ${input}`);
       // Walk the source, yield ImportedNote objects.
       yield {
         title: 'Example',
         body: '# Example\n\nbody…',
         tags: ['my-importer'],
         createdAt: new Date().toISOString(),
       };
     },
   };

   export default myImporter;
   ```

3. `npm run compile:electron` — TypeScript picks the new file up automatically
   because `apps/electron/tsconfig.json` includes `importers/**/*.ts`.
4. Restart the app. The startup log lists your importer; it appears in both
   the activity-bar chooser and the **File → Import from…** menu.

That's it. **No changes** to:

- `apps/electron/importers/loader.ts`
- `apps/electron/main.ts`
- `apps/electron/preload.ts`
- `apps/electron/renderer/renderer.ts`
- `apps/electron/renderer/index.html`

If a change to one of those files becomes necessary for a future importer (e.g.
to surface a new `ImporterInput.kind`), that's a contract change — bump the
contract in `types.ts` and update this doc in the same PR.

## Testing locally

```bash
npm run compile:electron
npm run dev:electron
```

Click **Import from…** in the activity bar (or **File → Import from…**), pick
the **Sample (smoke test)** entry, and confirm:

- Progress text reads `Imported 1 note…`.
- A note titled `Hello from the sample importer.md` lands under
  `<workspace>/Imported/sample/`.
- The file tree refreshes once the importer is done.

If the loader can't find a registered importer, the chooser shows the empty-
state message instead — that's a sign the loader scan didn't pick anything up
(check the main-process console for `[importers] skip <name> — …` lines).

## File layout

```
apps/electron/
├── importers/
│   ├── types.ts          ← contract (this PR)
│   ├── loader.ts         ← scanner + registry (this PR)
│   └── sample/
│       └── index.ts      ← smoke test (this PR)
├── main.ts               ← IPC + init (this PR adds a block at the bottom)
├── preload.ts            ← exposes window.mid.importers* (this PR)
└── renderer/
    ├── renderer.ts       ← chooser modal (this PR adds a block at the bottom)
    ├── renderer.css      ← chooser styles (this PR adds a block at the bottom)
    └── index.html        ← unchanged
```
