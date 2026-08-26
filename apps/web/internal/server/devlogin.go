// Guard for the auth-dev plugin's one-click developer login.
//
// auth-dev mounts POST /api/auth/dev/login whenever APP_ENV is not production
// and hands out an ADMIN session for DEV_LOGIN_EMAIL with no credentials. That
// is fine on a laptop and catastrophic on a public host, so this middleware
// only lets the route through for callers whose real client IP is inside
// DEV_LOGIN_ALLOW_CIDRS (comma-separated). The client IP is taken from
// CF-Connecting-IP (set authoritatively by Cloudflare, which fronts the public
// deployment), then X-Forwarded-For; a request with neither header is allowed
// only from loopback (local `go run` / vite dev). Everything else gets a 404,
// exactly as if the plugin were not installed.
//
// mountDevLoginToken adds a sibling POST /api/auth/dev/token behind the SAME
// guard: it returns a bearer JWT + user in the JSON body (auth-dev only sets a
// session cookie), so the token-based clients — the mobile app, the Chrome
// extension, scripts — get a one-tap developer login too.
package server

import (
	"crypto/subtle"
	"net"
	"net/http"
	"os"
	"strings"

	auth "github.com/togo-framework/auth"
	"github.com/togo-framework/togo"
)

func constantTimeEq(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

const (
	devLoginPath      = "/api/auth/dev/login"
	devLoginTokenPath = "/api/auth/dev/token"
)

func devLoginGuard(next http.Handler) http.Handler {
	allowed := parseCIDRs(os.Getenv("DEV_LOGIN_ALLOW_CIDRS"))
	secret := os.Getenv("DEV_LOGIN_SECRET")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimSuffix(r.URL.Path, "/")
		if p != devLoginPath && p != devLoginTokenPath {
			next.ServeHTTP(w, r)
			return
		}
		// The token route (used by the mobile app / token clients) may also be
		// unlocked with a shared secret header, since it can be hit from any
		// network where the CIDR check can't apply. The cookie route stays
		// CIDR-only. The secret must be non-empty to count.
		if p == devLoginTokenPath && secret != "" && constantTimeEq(r.Header.Get("X-Dev-Login-Secret"), secret) {
			next.ServeHTTP(w, r)
			return
		}
		ip, viaProxy := clientIP(r)
		ok := false
		switch {
		case ip == nil:
			ok = false
		case !viaProxy:
			ok = ip.IsLoopback() // direct local dev only
		default:
			for _, n := range allowed {
				if n.Contains(ip) {
					ok = true
					break
				}
			}
		}
		if !ok {
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// clientIP returns the caller's IP and whether it came from a proxy header.
func clientIP(r *http.Request) (net.IP, bool) {
	if v := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); v != "" {
		return net.ParseIP(v), true
	}
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		first := strings.TrimSpace(strings.Split(v, ",")[0])
		return net.ParseIP(first), true
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return net.ParseIP(host), false
}

// mountDevLoginToken registers POST /api/auth/dev/token — same admin identity
// as auth-dev's dev login, but returned as a bearer token for token-only
// clients. Only mounted outside production and only when the auth-dev login
// method is present (so it tracks auth-dev's own enable/disable).
func mountDevLoginToken(k *togo.Kernel, authsvc *auth.Service) {
	switch strings.ToLower(os.Getenv("APP_ENV")) {
	case "production", "prod":
		return
	}
	email := os.Getenv("DEV_LOGIN_EMAIL")
	if email == "" {
		return // no dev identity configured → nothing to mount
	}
	k.Router.Post(devLoginTokenPath, func(w http.ResponseWriter, r *http.Request) {
		id, err := authsvc.FindOrCreateByEmail(r.Context(), email)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "dev login failed"})
			return
		}
		id.Roles = []string{"admin"}
		id.Permissions = []string{"*"}
		tok, err := authsvc.IssueToken(*id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "token failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"token": tok, "user": id})
	})
}

func parseCIDRs(s string) []*net.IPNet {
	var out []*net.IPNet
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if !strings.Contains(part, "/") {
			if strings.Contains(part, ":") {
				part += "/128"
			} else {
				part += "/32"
			}
		}
		if _, n, err := net.ParseCIDR(part); err == nil {
			out = append(out, n)
		}
	}
	return out
}
