// App-level 2FA integration on top of togo-framework/auth-mfa.
//
// The base auth plugin's /api/auth/login always issues a session; auth-mfa
// ships the factor routes but leaves the login gate to the app. mountMFALogin
// adds POST /api/auth/mfa-login: credentials are verified exactly like the base
// login, but when the user has an activated TOTP factor the response carries a
// short-lived challenge token instead of a session — the client completes it at
// /api/auth/mfa/totp/verify (or recovery/verify), which issues the real session.
//
// mfaSelfGuard hardens the plugin's self-service routes (enroll / disable /
// recovery-generate): they trust a caller-supplied user_id, so we require an
// authenticated session and pin the subject to the caller's own id.
package server

import (
	"encoding/json"
	"net/http"
	"strings"

	auth "github.com/togo-framework/auth"
	mfa "github.com/togo-framework/auth-mfa"
	"github.com/togo-framework/togo"
)

func mountMFALogin(k *togo.Kernel, authsvc *auth.Service) {
	mfasvc, hasMFA := mfa.FromKernel(k)

	k.Router.Post("/api/auth/mfa-login", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" || body.Password == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email and password required"})
			return
		}
		guard := authsvc.Guard("api")
		if guard == nil || guard.Auth == nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "auth guard unavailable"})
			return
		}
		id, err := guard.Auth.Attempt(r.Context(), body.Email, body.Password)
		if err != nil || id == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
			return
		}
		if hasMFA && mfasvc.Required(id.ID) {
			challenge, err := mfasvc.IssueChallenge(id.ID)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "challenge failed"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"mfa_required": true, "challenge": challenge})
			return
		}
		tok, err := authsvc.IssueSession(w, *id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "session failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"token": tok, "user": id})
	})

	// GET /api/auth/mfa-status — does the caller have an activated factor?
	k.Router.Get("/api/auth/mfa-status", func(w http.ResponseWriter, r *http.Request) {
		id, ok := auth.IdentityFrom(r.Context())
		if !ok || id == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		enrolled := hasMFA && mfasvc.Required(id.ID)
		writeJSON(w, http.StatusOK, map[string]bool{"enrolled": enrolled})
	})
}

// mfaSelfGuardPaths are auth-mfa routes that manage the caller's own factors.
var mfaSelfGuardPaths = map[string]bool{
	"/api/auth/mfa/totp/enroll":       true,
	"/api/auth/mfa/totp/disable":      true,
	"/api/auth/mfa/recovery/generate": true,
}

// mfaSelfGuard runs after optionalIdentity: for self-service MFA routes it
// rejects anonymous callers and pins the subject to the authenticated user so
// nobody can enroll or disable factors for someone else's account.
func mfaSelfGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !mfaSelfGuardPaths[strings.TrimSuffix(r.URL.Path, "/")] {
			next.ServeHTTP(w, r)
			return
		}
		id, ok := auth.IdentityFrom(r.Context())
		if !ok || id == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		q := r.URL.Query()
		q.Del("user_id")
		r.URL.RawQuery = q.Encode()
		r.Header.Set("X-User-Id", id.ID) // subject() prefers query, then this header
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
