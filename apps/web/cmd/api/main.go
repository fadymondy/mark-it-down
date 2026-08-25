// Command api is the web HTTP entrypoint. It boots the shared togo stack
// (Huma REST + OpenAPI and gqlgen GraphQL on the kernel) and serves it.
//
// In production the same binary also serves the built SPA (web/dist) when
// WEB_DIST is set — one container, one port, no separate static host.
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/fadymondy/mark-it-down/apps/web/internal/server"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "openapi" {
		b, err := server.OpenAPI()
		if err != nil {
			panic(err)
		}
		os.Stdout.Write(b)
		return
	}

	a := server.Boot()
	defer a.Kernel.Close()
	k := a.Kernel
	if dist := os.Getenv("WEB_DIST"); dist != "" {
		serveSPA(k.Router, dist)
		fmt.Printf("→ serving SPA from %s\n", dist)
	}
	fmt.Printf("→ web listening on %s  (GraphQL %s · REST %s · docs %s)\n",
		k.Config.Addr, k.Config.GraphQLPath, k.Config.RESTPath, k.Config.DocsPath)
	if err := k.Serve(context.Background()); err != nil {
		panic(err)
	}
}

// serveSPA serves the built frontend from the same binary: real files are
// served directly (fingerprinted /assets/* cached hard), unknown extensionless
// paths fall back to index.html for client routing, and unregistered /api or
// /graphql paths return JSON 404 instead of the HTML shell. API routes are
// registered before this catch-all, so they always win. (Same pattern as the
// togo cabrain service.)
func serveSPA(router interface {
	Handle(pattern string, h http.Handler)
}, dist string) {
	fs := http.FileServer(http.Dir(dist))
	index := filepath.Join(dist, "index.html")
	router.Handle("/*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/graphql" || r.URL.Path == "/mcp" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"code":"not_found","message":"no such API route"}}`))
			return
		}
		p := filepath.Join(dist, filepath.Clean(r.URL.Path))
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			fs.ServeHTTP(w, r)
			return
		}
		if ext := filepath.Ext(r.URL.Path); ext != "" && ext != ".html" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache, must-revalidate")
		http.ServeFile(w, r, index)
	}))
}
