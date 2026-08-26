// Password reset completion. The auth plugin's /api/auth/otp (purpose "reset")
// emails a code and /api/auth/otp/verify checks it, but nothing sets the new
// password — this endpoint closes the loop in one step: verify the reset code
// for the email, then replace the user's password hash. Rate-limited by the
// same brute-force budget as the plugin's own OTP routes (10 / 5 min per IP).
package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/togo-framework/togo"
	"golang.org/x/crypto/bcrypt"
)

func mountPasswordReset(k *togo.Kernel) {
	rl := &ipLimiter{max: 10, window: 5 * time.Minute, hits: map[string][]time.Time{}}
	k.Router.Post("/api/auth/reset-password", func(w http.ResponseWriter, r *http.Request) {
		if !rl.allow(clientKey(r)) {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many attempts, try again later"})
			return
		}
		var body struct {
			Email    string `json:"email"`
			Code     string `json:"code"`
			Password string `json:"new_password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" || body.Code == "" || len(body.Password) < 8 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email, code and a password of at least 8 characters are required"})
			return
		}
		email := strings.ToLower(strings.TrimSpace(body.Email))
		ctx := r.Context()
		db, err := k.SQL(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "unavailable"})
			return
		}
		var hash, exp string
		if err := db.QueryRowContext(ctx, `SELECT code_hash, expires_at FROM otp_codes WHERE subject = ? AND purpose = 'reset'`, email).Scan(&hash, &exp); err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid or expired code"})
			return
		}
		if t, err := time.Parse(time.RFC3339, exp); err != nil || time.Now().After(t) || bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.Code)) != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid or expired code"})
			return
		}
		newHash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "hash failed"})
			return
		}
		res, err := db.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE lower(email) = ?`, string(newHash), email)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "update failed"})
			return
		}
		_, _ = db.ExecContext(ctx, `DELETE FROM otp_codes WHERE subject = ? AND purpose = 'reset'`, email)
		if n, _ := res.RowsAffected(); n == 0 {
			// Same answer as a bad code so the endpoint can't be used to enumerate accounts.
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid or expired code"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "password updated"})
	})
}

type ipLimiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string][]time.Time
}

func (l *ipLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	keep := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if now.Sub(t) < l.window {
			keep = append(keep, t)
		}
	}
	if len(keep) >= l.max {
		l.hits[key] = keep
		return false
	}
	l.hits[key] = append(keep, now)
	return true
}

func clientKey(r *http.Request) string {
	if ip, _ := clientIP(r); ip != nil {
		return ip.String()
	}
	return r.RemoteAddr
}
