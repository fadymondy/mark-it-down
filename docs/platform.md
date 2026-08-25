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

## Deploying the web app (markitdown.fadymondy.com)

The web service is published exactly like the other ToGo services on this host
(cabrain, circlexo, health…): a container on the WSL stack, exposed through a
reverse-SSH tunnel to the Proxmox edge, where Nginx Proxy Manager routes the
hostname and Cloudflare fronts it.

```
Cloudflare (explicit proxied A record → 45.129.183.99; the *.fadymondy.com wildcard
  points at a dead IP, so an unlisted subdomain returns 522)
  → NPM on Proxmox LXC 100 (https://npm.3x1.io, host "markitdown.fadymondy.com",
    Cloudflare Origin cert, SSL forced) → http://10.10.10.1:4572
  → reverse SSH tunnel from the Windows box (Scheduled Task `markitdown-tunnel`,
    E:SitesToGo.setupmarkitdown-tunnel.ps1: -R 10.10.10.1:4572 → 127.0.0.1:9320)
  → WSL container `markitdown` (published 127.0.0.1:9320 → :8080)
```

The *local* WSL NPM (18080/18443/8181) and Windows Firewall are not in this path:
WSL containers cannot reach Windows-side listeners, so the app runs in WSL and the
tunnel picks it up from the published loopback port.

1. **Build the artifacts on the host** (no network needed inside the image):
   ```bash
   cd apps/web
   GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/web-linux ./cmd/api
   (cd web && VITE_API_ORIGIN= VITE_APP_NAME="Mark It Down" npx vite build)
   ```
2. **Build + run the container** from the WSL dir `~/services/markitdown/`
   (`docker-compose.yml` builds from `/mnt/e/Sites/mark-it-down/apps/web`, joins
   `stack_stacknet`, publishes `127.0.0.1:9320`, mounts `markitdown_data` for the
   SQLite file and `markitdown_storage`, and reads `AUTH_SECRET` from its private `.env`):
   ```bash
   cd ~/services/markitdown && docker compose up -d --build
   curl -s http://127.0.0.1:9320/api/health     # from Windows or WSL
   ```
3. **Tunnel** — the `markitdown-tunnel` Scheduled Task (logon trigger) keeps the
   `-R 10.10.10.1:4572:127.0.0.1:9320` forward alive; log in `.setup/markitdown-tunnel.log`.
4. **NPM + DNS** (one-time, done): NPM proxy host id 24 → `http://10.10.10.1:4572`,
   Cloudflare A record `markitdown` → `45.129.183.99` (proxied). Credentials live in
   the cabrain `togo` brain's secrets vault.
5. **Redeploy** = rebuild the two artifacts, then `docker compose up -d --build`.

Production env set in the image: `APP_ENV=production`, `ADDR=:8080`,
`WEB_DIST=/app/web/dist`, SQLite at `/app/data/togo.db`; the compose adds
`COOKIE_SECURE=1`, `MAIL_DRIVER=log` (switch to SMTP via `MAIL_*` for real
password-reset emails) and `UPDATES_REPO`.

### Migrations and the developer login on the public host

- The container entrypoint (`apps/web/start.sh`) runs `cmd/migrate` (applies the
  idempotent `internal/db/schema/*.sql`) against the mounted SQLite volume before
  starting the API — a fresh volume is usable on first boot, and redeploys are safe.
- The public container runs with `APP_ENV=staging` (not `production`) so the
  `auth-dev` plugin mounts its one-click **Login as developer** button. Because that
  route hands out an *admin* session for `DEV_LOGIN_EMAIL` with no credentials,
  `internal/server/devlogin.go` only lets it through when the Cloudflare-reported
  client IP is inside `DEV_LOGIN_ALLOW_CIDRS` (home WAN + tailnet); any other caller
  — including requests that reach the container without a Cloudflare/proxy header —
  gets a 404. Update the CIDR list in `~/services/markitdown/docker-compose.yml`
  when the home WAN IP changes.
