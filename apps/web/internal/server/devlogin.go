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
package server

import (
	"net"
	"net/http"
	"os"
	"strings"
)

const devLoginPath = "/api/auth/dev/login"

func devLoginGuard(next http.Handler) http.Handler {
	allowed := parseCIDRs(os.Getenv("DEV_LOGIN_ALLOW_CIDRS"))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.TrimSuffix(r.URL.Path, "/") != devLoginPath {
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
