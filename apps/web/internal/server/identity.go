// Optional identity resolution for the generated REST/GraphQL handlers.
//
// The auth plugin's Middleware is strict — it 401s anonymous requests — but the
// generated Huma CRUD routes are mounted directly on the kernel router where
// public endpoints (health, shared notes, updates feed) also live. This wrapper
// runs the strict middleware against a discarding writer: when credentials are
// valid the request continues with the Identity in context, otherwise the 401
// is swallowed and the request continues anonymously. Handlers that need a
// caller check auth.IdentityFrom(ctx) themselves.
package server

import (
	"net/http"

	auth "github.com/togo-framework/auth"
)

func optionalIdentity(s *auth.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authed := false
			s.Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r2 *http.Request) {
				authed = true
				next.ServeHTTP(w, r2)
			})).ServeHTTP(discardWriter{}, r)
			if !authed {
				next.ServeHTTP(w, r)
			}
		})
	}
}

// discardWriter swallows the strict middleware's 401 body/headers.
type discardWriter struct{}

func (discardWriter) Header() http.Header         { return http.Header{} }
func (discardWriter) Write(b []byte) (int, error) { return len(b), nil }
func (discardWriter) WriteHeader(int)             {}
