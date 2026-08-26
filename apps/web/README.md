# Web

Built with [togo](https://github.com/togo-framework) — Go, the artisan way.
API-first (GraphQL + REST/OpenAPI), Supabase auth, plugin-extensible, AI-native.

## Quickstart

```bash
cp .env.example .env          # configure DATABASE_URL + Supabase
docker compose up -d          # Postgres / Supabase
togo make:resource Post title:string body:text:nullable
togo generate                 # sqlc + gqlgen + atlas + openapi
togo migrate
togo serve                    # backend + frontend together
```

`togo serve` runs **both** the Go API and the Next.js frontend (installing web
deps on first run). Use `togo serve --api-only` / `--web-only`, or `togo web`.

- API → http://localhost:8080  (GraphQL `/graphql` · REST `/api` · docs `/docs`)
- Web → http://localhost:3000

## Stack

- **API**: chi + Huma (REST/OpenAPI 3.1) + gqlgen (GraphQL)
- **Data**: sqlc (typed queries) + Atlas (migrations) + pgx/Postgres
- **Auth + Storage**: Supabase (`@supabase/ssr`) — client/server/middleware wired
- **Frontend**: Next.js 15 (App Router) + Tailwind CSS v4 + shadcn-style `ui/`
  primitives (CVA + `cn()`), `next-themes` (dark mode), `sonner` toasts, lucide icons
- **AI**: `.claude/` skills + agents + `.mcp.json` wired to the togo MCP server

## Layout

```
cmd/api/            HTTP entrypoint (REST + GraphQL)
internal/models/    domain structs            (togo make:resource)
internal/db/        sqlc schema + queries + generated code
internal/graph/     GraphQL schema + resolvers
internal/rest/      Huma handlers + generated route registry
internal/resources/ resource descriptors (dashboard/admin)
db/atlas/           Atlas desired-state schema + migrations
web/                Next.js frontend
.claude/            skills, agents, rules for Claude Code
togo.yaml           project config
togo.resources.yaml resource manifest (source of truth for codegen)
```
