module github.com/fadymondy/mark-it-down/apps/web

go 1.26.4

require (
	github.com/99designs/gqlgen v0.17.94
	github.com/danielgtaylor/huma/v2 v2.27.0
	github.com/go-chi/chi/v5 v5.1.0
	github.com/togo-framework/togo v0.21.0
	github.com/vektah/gqlparser/v2 v2.5.36
	// SQLite is the built-in default driver. Postgres/MySQL/Mongo drivers come from
	// their db-* PLUGIN (added to internal/plugins by `togo new --db`), which pulls
	// the raw driver transitively — so it isn't a direct dependency of this app.
	modernc.org/sqlite v1.34.1
)

require (
	github.com/microcosm-cc/bluemonday v1.0.27
	github.com/modelcontextprotocol/go-sdk v1.6.1
	github.com/togo-framework/auth v0.8.0
	github.com/togo-framework/auth-dev v0.1.0
	github.com/togo-framework/auth-mfa v0.1.0
	github.com/togo-framework/faker v0.1.0
	github.com/togo-framework/mail v0.1.0
	github.com/togo-framework/orm v0.1.0
	github.com/togo-framework/validation v0.1.0
	github.com/yuin/goldmark v1.8.5
	golang.org/x/crypto v0.55.0
)

require (
	github.com/agnivade/levenshtein v1.2.1 // indirect
	github.com/aymerick/douceur v0.2.0 // indirect
	github.com/boombuler/barcode v1.0.1-0.20190219062509-6c824513bacc // indirect
	github.com/coder/websocket v1.8.15 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/go-viper/mapstructure/v2 v2.5.0 // indirect
	github.com/goccy/go-yaml v1.19.2 // indirect
	github.com/golang-jwt/jwt/v5 v5.3.1 // indirect
	github.com/google/jsonschema-go v0.4.3 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/gorilla/css v1.0.1 // indirect
	github.com/hashicorp/golang-lru/v2 v2.0.7 // indirect
	github.com/mattn/go-isatty v0.0.21 // indirect
	github.com/ncruces/go-strftime v0.1.9 // indirect
	github.com/pquerna/otp v1.4.0 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	github.com/segmentio/asm v1.1.3 // indirect
	github.com/segmentio/encoding v0.5.4 // indirect
	github.com/sosodev/duration v1.4.0 // indirect
	github.com/urfave/cli/v3 v3.10.1 // indirect
	github.com/yosida95/uritemplate/v3 v3.0.2 // indirect
	golang.org/x/mod v0.39.0 // indirect
	golang.org/x/net v0.58.0 // indirect
	golang.org/x/oauth2 v0.35.0 // indirect
	golang.org/x/sync v0.22.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/text v0.41.0 // indirect
	golang.org/x/tools v0.49.0 // indirect
	modernc.org/gc/v3 v3.0.0-20240107210532-573471604cb6 // indirect
	modernc.org/libc v1.55.3 // indirect
	modernc.org/mathutil v1.6.0 // indirect
	modernc.org/memory v1.8.0 // indirect
	modernc.org/strutil v1.2.0 // indirect
	modernc.org/token v1.1.0 // indirect
)
