# Export filenames

Every export action in Mark It Down stamps its output filename with a short unique id, so re-exporting the same document never overwrites a prior file and you can copy-paste the suffix to refer back to a specific run.

## Format

```
<basename>--<id>.<ext>
```

- `<basename>` — derived from the source file's name (or a fixed label like `code`, `diagram`, `table` for non-document exports). Sanitized to `[A-Za-z0-9._-]`, falling back to `export` if empty.
- `<id>` — first 8 hex characters of `crypto.randomUUID()` (~32 bits of entropy, ~4 billion values).
- `<ext>` — the export format: `md`, `txt`, `html`, `pdf`, `png`, `docx`, `csv`, `json`, `xlsx`, `svg`.

## Examples

| Action                               | Filename                              |
| ------------------------------------ | ------------------------------------- |
| Export PDF on `roadmap.md`           | `roadmap--3a7f0c19.pdf`                |
| Export PNG on `roadmap.md`           | `roadmap--c4e6810b.png`                |
| Export DOCX on `roadmap.md`          | `roadmap--98a142f7.docx`               |
| Code-block PNG export                 | `code--71ed4f02.png`                   |
| Mermaid SVG export                    | `diagram--0bf81d77.svg`                |
| Mermaid PNG export                    | `diagram--be20a1c5.png`                |
| Table → CSV                           | `table--5dd9a206.csv`                  |
| Table → Excel (xlsx)                  | `table--5dd9a206.xlsx`                 |
| Table → JSON                          | `table--5dd9a206.json`                 |

## What this does NOT affect

- **Save** / **Save As** keep using the source filename (or `untitled.md` for a brand-new doc) — they're authoring actions, not exports, so the user picks the final name.
- The system Save dialog still appears for every export and the user can override the suggested name before writing.

## Implementation

Helpers live in `apps/electron/renderer/renderer.ts`:

```ts
function shortExportId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

function uniqueExportName(base: string, ext: string): string {
  const safe = base.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_.]/g, '_') || 'export';
  return `${safe}--${shortExportId()}.${ext}`;
}
```

`defaultExportName(ext)` (the helper used by every `exportAs(format)` branch) is now a thin wrapper around `uniqueExportName` so PDF, PNG, DOCX, HTML, MD, TXT all flow through the same path. Code-block, mermaid, and table exports call `uniqueExportName` directly.
