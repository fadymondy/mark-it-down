# Platform architecture — web · desktop · VSCode · Chrome

Issue: [#328](https://github.com/fadymondy/mark-it-down/issues/328)

Mark It Down runs on four surfaces backed by one cloud service:

```
┌────────────────────────────── surfaces ──────────────────────────────┐
│                                                                       │
│  VSCode extension        Electron desktop        Chrome extension     │
│  (src/, root pkg)        (apps/electron)         (apps/chrome-ext.)   │
│        │                       │                        │             │
│        └──────────── packages/core (shared, source-only) ─────────────┤
│              markdown renderer · 25 themes · search · wikilinks       │
│              frontmatter · categories · semver · secrets · epub       │
│                                                                       │
└──────────────────────────────┬────────────────────────────────────────┘
                               │  HTTPS (session cookie or bearer PAT)
                    ┌──────────▼───────────┐
                    │  apps/web — ToGo app │
                    │  Go API + TanStack SPA
                    │  · auth + TOTP 2FA   │
                    │  · notes warehouse   │
                    │  · public sharing    │
                    │  · MCP connector /mcp│
                    │  · /api/updates feed │
                    │  · /api/admin panel  │
                    └──────────────────────┘
```

## apps/web — the ToGo service

Built on the [togo framework](https://github.com/togo-framework/togo) (Go microkernel
+ plugins) with the TanStack (Vite + React 19 + TanStack Router/Query) SPA the
framework scaffolds. Installed plugins: `auth`, `auth-mfa`, `auth-dev` (dev only),
`mail`, `cache`, `storage`, `realtime`, `i18n`.

| Surface | Where |
|---|---|
| Landing page (install links per platform) | `/` — reads `/api/updates` |
| Auth: register / login / logout / me | `/api/auth/*` (auth plugin) |
| Password reset | email OTP: `POST /api/auth/otp` (purpose `reset`) + `otp/verify` — delivery bridged to the mail plugin in `internal/server/otpmail.go` |
| TOTP 2FA | app-gated login `POST /api/auth/mfa-login` → challenge → `POST /api/auth/mfa/totp/verify` (see `internal/server/mfa.go`; self-service enroll/disable is pinned to the session identity) |
| Personal access tokens | `POST/GET/DELETE /api/auth/tokens` — bearer `togo_pat_…` works everywhere a session does |
| Notes warehouse | `GET/POST /api/notes`, `PUT/DELETE /api/notes/{id}` — always scoped to the caller (`internal/rest/note_handler.go`); admins may pass `?all=1` |
| Public sharing | `POST /api/notes/{id}/share` → slug; anonymous `GET /api/shared/{slug}` returns sanitized HTML (goldmark + bluemonday); SPA page `/s/{slug}` |
| MCP connector | `POST /mcp` — Streamable HTTP behind the auth middleware; tools `list_notes`, `get_note`, `create_note`, `update_note`, `delete_note`, `search_notes` (parity with the stdio server in `src/mcp/server.ts`) |
| Update feed | `GET /api/updates` and `/api/updates/{platform}` (`windows` `mac` `linux` `vscode` `chrome`), 10-min cached proxy over GitHub Releases |
| Admin | `/api/admin/users` (+ impersonate / reset / magic-link), `/api/admin/mail`, resource CRUD driven by `/api/_meta/resources` |

Run it locally:

```bash
cd apps/web
cp .env.example .env          # set AUTH_SECRET (>=32 bytes) — required in production
go run ./cmd/api              # API on :8080
cd web && npm install && npx vite   # SPA on :3000 (proxies /api → :8080)
```

Or with the togo CLI: `togo dev` (both), `togo generate && togo migrate` after
editing `togo.resources.yaml`.

### Connecting an MCP client

Mint a token in **Profile → Access tokens**, then:

```json
{
  "mcpServers": {
    "mark-it-down": {
      "type": "http",
      "url": "https://<your-server>/mcp",
      "headers": { "Authorization": "Bearer togo_pat_…" }
    }
  }
}
```

## Auto-update matrix

GitHub Releases is the single source of truth. Every surface updates from it —
directly or through a store that mirrors it:

| Surface | Mechanism | Where implemented |
|---|---|---|
| Electron desktop | `electron-updater` — auto-download, install on quit (channels: stable/beta) | `apps/electron/main.ts` `setupAutoUpdate()`; publishes via `release.yml` |
| VSCode extension | Marketplace auto-update + in-app release checker (6-hourly, "what's new" toast) | `src/updates/updateChecker.ts` |
| Chrome extension | Chrome Web Store auto-update + daily release check (badge when newer) | `apps/chrome-extension/src/background.ts` |
| Web app | Self-updating on deploy; serves the feed for everyone else | `apps/web/internal/updates/updates.go` |
| Mac App Store build | MAS handles updates (electron-updater opted out) | `docs/desktop-mac-app-store.md` |

The landing page's download buttons and the extensions' checkers all consume
`/api/updates/{platform}?redirect=1` (or the raw GitHub API as fallback), so a
new tag on `main` propagates everywhere with zero extra steps:

```bash
git tag v0.3.0 && git push --tags   # release.yml builds electron installers,
                                    # the .vsix, and the chrome zip, attaches
                                    # all of them + CHANGELOG notes
```

## Repository layout

```
mark-it-down/
├── src/                  VSCode extension (root package.json, unchanged layout)
├── apps/electron/        Desktop app (electron-builder config in root package.json)
├── apps/web/             ToGo service: Go API (cmd/, internal/) + SPA (web/)
├── apps/chrome-extension/ MV3 extension (own package.json + esbuild)
├── packages/core/        Shared source-only TS (imported relatively, bundled per app)
├── packages/ui-tokens/   Shared design tokens + icon set
└── plugins/              Claude Code plugin (bundled MCP stdio server)
```

`packages/*` stay source-only on purpose — each app's bundler (tsc/esbuild/vite)
compiles them in place, so there is still no workspace tooling to maintain.
