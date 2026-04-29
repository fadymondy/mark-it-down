# Telemetry

Status: shipped in v1.2 · Issue: [#37](https://github.com/fadymondy/mark-it-down/issues/37)

Mark It Down can send anonymized error reports to help us find + fix bugs. **It's off by default**, requires explicit opt-in, and you can disable it any time. This page documents exactly what's collected and how to verify.

## At a glance

| | |
|---|---|
| **Default** | Off. The first activation prompts you with `Enable / Keep off / Learn more`. |
| **Where it goes** | A [Sentry](https://sentry.io)-compatible DSN you configure. The official Mark It Down build ships **without** a default DSN — events are collected only if you explicitly point `markItDown.telemetry.dsn` at your own Sentry project. |
| **What's sent** | Stack traces, error messages, breadcrumbs from before the crash. **Never** note content, file content, or anything you've typed. |
| **PII filter** | Absolute paths in errors / stacks are rewritten before sending: workspace paths → `<workspace>`, your home dir → `~`, the extension dir → `<extension>`, system temp → `<tmp>`. |
| **Session id** | A random 16-char hex generated per VSCode launch. Not persisted, not user-identifying. Lets us group "all errors from the same session" without knowing who you are. |

## Settings

| Setting | Default | What it does |
|---|---|---|
| `markItDown.telemetry.enabled` | `false` | Master switch. Off by default. The first-run consent toast can flip this; you can flip it back any time in Settings. |
| `markItDown.telemetry.dsn` | `""` | Sentry DSN (e.g. `https://abc123@o123.ingest.sentry.io/456`). Empty means no events leave your machine even if `enabled: true`. |

Both surfaces (VSCode extension + Electron app, when wired) honor the same setting names.

## Consent flow

On the first activation after this feature ships:

1. Info toast: "Mark It Down: help improve the extension by sending anonymized error reports? Default is off." with three buttons:
   - **Enable** → flips `markItDown.telemetry.enabled = true` globally
   - **Keep off** → leaves the setting at `false`; the toast doesn't reappear
   - **Learn more** → opens this page in a browser; the toast doesn't reappear (you can flip the setting later in Settings)
2. The consent prompt **only shows once** — `globalState[markItDown.telemetry.consentShown]` is set after the first display.

## What goes over the wire

When `enabled: true` AND a DSN is set:

| Field | Sent | Sanitization |
|---|---|---|
| Error stack frames | yes | filenames rewritten via PII filter |
| Error message | yes | rewritten via PII filter, truncated at 4096 chars |
| `release` (extension version from package.json) | yes | unchanged |
| `environment` | yes | always `"production"` |
| `tags.mid.session` | yes | random 16-char hex per launch |
| `tags.mid.surface` | yes | `"vscode"` |
| Sentry breadcrumbs (if any) | yes | rewritten via PII filter |
| Note content | **no** | the warehouse / notes modules don't call `captureException` with note bodies |
| File content | **no** | same |
| `tracesSampleRate` | n/a | `0` — no performance traces are collected |

## What's NEVER sent

- The text of any note (the notes warehouse doesn't capture content as exception data)
- Markdown file content open in the editor
- Workspace folder names beyond what's needed to anonymize them in stacks
- Username, email, machine name, IP (Sentry strips IPs by default; we don't send anything that would override that)
- Tokens / secrets (the secret-scanner blocks pre-push and we don't capture editor buffers anyway)

## How to verify

1. Set `markItDown.telemetry.enabled: true` and a DSN you control.
2. Run **Mark It Down: Telemetry: Send Test Event** from the command palette.
3. Within ~30s, your Sentry project should show an info-level event with message `Mark It Down test event from command palette`, tagged `mid.session=<hex>` and `mid.surface=vscode`.
4. Inspect the event in the Sentry UI — confirm there are no absolute paths from your machine.

## Disabling

Two paths:

- **Setting**: flip `markItDown.telemetry.enabled` to `false` in `Cmd+,` → "Mark It Down: Telemetry"
- **Global**: leave `markItDown.telemetry.dsn` empty — even with `enabled: true`, no events go anywhere without a DSN

The `Sentry.close()` call on dispose ensures any in-flight events are flushed (with a 2s timeout).

## Why opt-in, not opt-out

Two reasons:

1. **Trust**: notes are private by definition. An opt-in posture says we're aware of that and aren't leaking data without permission.
2. **Honest signal**: the events that come from explicit opt-in users are usually from people willing to follow up if you reach out — much better signal than passive opt-out collection.

## What we'd love to add later (not in v1.2)

- Per-feature opt-in (e.g. enable telemetry only for warehouse sync errors, not for editor crashes)
- Local event log so you can audit exactly what would be sent before flipping the switch
- A `Telemetry: Show Last Event` command that displays the most recent payload locally without sending

## Files of interest

- [src/telemetry/sanitize.ts](../src/telemetry/sanitize.ts) — `sanitizePaths`, `sanitizeDeep`, `generateSessionId`, `StaticPathAnchors`
- [src/telemetry/telemetryClient.ts](../src/telemetry/telemetryClient.ts) — `TelemetryClient` (consent prompt + Sentry init + lifecycle)
- [src/extension.ts](../src/extension.ts) — wires the client on activation
- [package.json](../package.json) — `markItDown.telemetry.enabled` + `.dsn` settings; `Telemetry: Send Test Event` command
- [tests/unit/telemetrySanitize.test.ts](../tests/unit/telemetrySanitize.test.ts) — 9 unit tests for the sanitizer
