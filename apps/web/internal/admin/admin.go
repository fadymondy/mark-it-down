// Package admin ships the out-of-the-box user-management + mail-setup
// admin API. It mounts under /api/admin/* and is consumed by the web/ admin
// pages (the @togo-framework/ui admin suite: UserManagementTable,
// UserActionsMenu, AddUserDialog, MailSettingsForm).
//
// All accounts come from the togo auth plugin's `users` table; this handler
// never invents its own schema. When the auth plugin isn't installed the
// provider quietly no-ops, so the app still builds and boots.
package admin

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/smtp"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/togo-framework/togo"
	auth "github.com/togo-framework/auth"
	"golang.org/x/crypto/bcrypt"
)

func init() {
	// PriorityLate+30 → mount after every plugin (and after auth's middleware),
	// so chi's "middleware before routes" rule is never violated.
	togo.RegisterProviderFunc("mid-admin", togo.PriorityLate+30, func(k *togo.Kernel) error {
		if k.Router == nil {
			return nil
		}
		a, ok := auth.FromKernel(k)
		if !ok {
			// Auth plugin not installed → the admin API has no user store. Skip
			// mounting; the web/ admin pages will show their "endpoint unavailable"
			// state. Install it with `togo install togo-framework/auth`.
			if k.Log != nil {
				k.Log.Info("mid-admin: auth plugin not installed — admin API disabled")
			}
			return nil
		}
		s := &server{k: k, auth: a}
		s.mount(k.Router)
		return nil
	})
}

type server struct {
	k    *togo.Kernel
	auth *auth.Service
}

func (s *server) mount(r chi.Router) {
	// Write/action endpoints require an authenticated session (the auth plugin's
	// middleware). Apps that need role checks can tighten this further.
	r.Route("/api/admin", func(r chi.Router) {
		r.Use(s.auth.Middleware)
		r.Get("/users", s.listUsersHandler)
		r.Get("/users/{id}", s.getUser)
		r.Post("/users", s.createUser)
		r.Patch("/users/{id}", s.updateUser)
		r.Delete("/users/{id}", s.deleteUser)
		r.Post("/users/{id}/impersonate", s.impersonate)
		r.Post("/users/{id}/reset-password", s.resetPassword)
		r.Post("/users/{id}/magic-link", s.magicLink)

		r.Get("/mail", s.getMail)
		r.Put("/mail", s.putMail)
		r.Post("/mail/test", s.testMail)
	})

	// Public auto-login target (magic + admin-issued reset links point here).
	r.Get("/magic", s.magicHandler)
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func contains(ss []string, v string) bool {
	for _, s := range ss {
		if s == v {
			return true
		}
	}
	return false
}

func (s *server) db(ctx context.Context) (*sql.DB, func(int) string) {
	db, _ := s.k.SQL(ctx)
	return db, s.k.Dialect().Placeholder
}

// ---- users (read) ----

// User is the admin-facing shape of an account (from the auth plugin's users table).
type User struct {
	ID          string   `json:"id"`
	Email       string   `json:"email"`
	Roles       []string `json:"roles"`
	Permissions []string `json:"permissions"`
	CreatedAt   string   `json:"created_at"`
}

func (s *server) listUsers(ctx context.Context, q string) []User {
	db, _ := s.db(ctx)
	if db == nil {
		return []User{}
	}
	rows, err := db.QueryContext(ctx,
		`SELECT id, email, COALESCE(roles,''), COALESCE(permissions,''), created_at FROM users ORDER BY created_at DESC LIMIT 500`)
	if err != nil {
		return []User{}
	}
	defer rows.Close()
	out := []User{}
	ql := strings.ToLower(strings.TrimSpace(q))
	for rows.Next() {
		var u User
		var roles, perms, created string
		if err := rows.Scan(&u.ID, &u.Email, &roles, &perms, &created); err != nil {
			continue
		}
		u.Roles = splitList(roles)
		u.Permissions = splitList(perms)
		u.CreatedAt = created
		if ql != "" && !strings.Contains(strings.ToLower(u.Email), ql) {
			continue
		}
		out = append(out, u)
	}
	return out
}

func (s *server) userByID(ctx context.Context, id string) (User, bool) {
	for _, u := range s.listUsers(ctx, "") {
		if u.ID == id || u.Email == id {
			return u, true
		}
	}
	return User{}, false
}

func (s *server) listUsersHandler(w http.ResponseWriter, req *http.Request) {
	writeJSON(w, 200, s.listUsers(req.Context(), req.URL.Query().Get("q")))
}

func (s *server) getUser(w http.ResponseWriter, req *http.Request) {
	u, ok := s.userByID(req.Context(), chi.URLParam(req, "id"))
	if !ok {
		writeErr(w, 404, "user not found")
		return
	}
	writeJSON(w, 200, u)
}

// ---- create ----

func (s *server) createUser(w http.ResponseWriter, req *http.Request) {
	var body struct {
		Email       string   `json:"email"`
		Password    string   `json:"password"`
		Roles       []string `json:"roles"`
		Permissions []string `json:"permissions"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))
	if body.Email == "" {
		writeErr(w, 400, "email is required")
		return
	}
	ctx := req.Context()
	if _, exists := s.userByID(ctx, body.Email); exists {
		writeErr(w, 409, "a user with that email already exists")
		return
	}
	// Create the account via the auth service, then set roles/permissions/password.
	_, _ = s.auth.FindOrCreateByEmail(ctx, body.Email)
	db, ph := s.db(ctx)
	if db == nil {
		writeErr(w, 500, "no database")
		return
	}
	_, _ = db.ExecContext(ctx, "UPDATE users SET roles="+ph(1)+", permissions="+ph(2)+" WHERE email="+ph(3),
		strings.Join(body.Roles, ","), strings.Join(body.Permissions, ","), body.Email)
	note := ""
	if body.Password != "" {
		if h, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost); err == nil {
			_, _ = db.ExecContext(ctx, "UPDATE users SET password_hash="+ph(1)+" WHERE email="+ph(2), string(h), body.Email)
		}
	} else {
		note = "no password set — send a reset or magic link so the user can sign in"
	}
	u, _ := s.userByID(ctx, body.Email)
	writeJSON(w, 201, map[string]any{"user": u, "note": note})
}

// ---- update ----

func (s *server) updateUser(w http.ResponseWriter, req *http.Request) {
	ctx := req.Context()
	u, ok := s.userByID(ctx, chi.URLParam(req, "id"))
	if !ok {
		writeErr(w, 404, "user not found")
		return
	}
	var body struct {
		Email       *string   `json:"email"`
		Roles       *[]string `json:"roles"`
		Permissions *[]string `json:"permissions"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	db, ph := s.db(ctx)
	if db == nil {
		writeErr(w, 500, "no database")
		return
	}
	if body.Email != nil && *body.Email != "" {
		_, _ = db.ExecContext(ctx, "UPDATE users SET email="+ph(1)+" WHERE id="+ph(2), strings.ToLower(*body.Email), u.ID)
	}
	if body.Roles != nil {
		_, _ = db.ExecContext(ctx, "UPDATE users SET roles="+ph(1)+" WHERE id="+ph(2), strings.Join(*body.Roles, ","), u.ID)
	}
	if body.Permissions != nil {
		_, _ = db.ExecContext(ctx, "UPDATE users SET permissions="+ph(1)+" WHERE id="+ph(2), strings.Join(*body.Permissions, ","), u.ID)
	}
	updated, _ := s.userByID(ctx, u.ID)
	writeJSON(w, 200, updated)
}

// ---- delete ----

func (s *server) deleteUser(w http.ResponseWriter, req *http.Request) {
	ctx := req.Context()
	u, ok := s.userByID(ctx, chi.URLParam(req, "id"))
	if !ok {
		writeErr(w, 404, "user not found")
		return
	}
	// Never delete the last admin — that would lock everyone out.
	admins := 0
	for _, x := range s.listUsers(ctx, "") {
		if contains(x.Roles, "admin") {
			admins++
		}
	}
	if contains(u.Roles, "admin") && admins <= 1 {
		writeErr(w, 409, "cannot delete the last admin")
		return
	}
	db, ph := s.db(ctx)
	if db == nil {
		writeErr(w, 500, "no database")
		return
	}
	_, _ = db.ExecContext(ctx, "DELETE FROM users WHERE id="+ph(1), u.ID)
	writeJSON(w, 200, map[string]any{"deleted": true, "id": u.ID})
}

// ---- impersonate ----

func (s *server) impersonate(w http.ResponseWriter, req *http.Request) {
	ctx := req.Context()
	u, ok := s.userByID(ctx, chi.URLParam(req, "id"))
	if !ok {
		writeErr(w, 404, "user not found")
		return
	}
	id := auth.Identity{ID: u.ID, Email: u.Email, Roles: u.Roles, Permissions: u.Permissions, Guard: "api"}
	// Switch the current session cookie to the target user.
	if _, err := s.auth.IssueSession(w, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	tok, _ := s.auth.IssueToken(id)
	writeJSON(w, 200, map[string]any{"token": tok, "identity": u})
}

// ---- reset password ----

func (s *server) resetPassword(w http.ResponseWriter, req *http.Request) {
	ctx := req.Context()
	u, ok := s.userByID(ctx, chi.URLParam(req, "id"))
	if !ok {
		writeErr(w, 404, "user not found")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	_ = json.NewDecoder(req.Body).Decode(&body)
	db, ph := s.db(ctx)
	if body.Password != "" {
		if db == nil {
			writeErr(w, 500, "no database")
			return
		}
		h, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		_, _ = db.ExecContext(ctx, "UPDATE users SET password_hash="+ph(1)+" WHERE id="+ph(2), string(h), u.ID)
		writeJSON(w, 200, map[string]any{"reset": true})
		return
	}
	// No password → email/return a magic login link the user can use to set one.
	link := s.linkURL(req, u.ID)
	emailed := s.maybeSendMail(ctx, u.Email, "Reset your Demo password",
		"Use this link to sign in and set a new password:\n\n"+link)
	writeJSON(w, 200, map[string]any{"link": link, "emailed": emailed})
}

// ---- magic link ----

func (s *server) magicLink(w http.ResponseWriter, req *http.Request) {
	ctx := req.Context()
	u, ok := s.userByID(ctx, chi.URLParam(req, "id"))
	if !ok {
		writeErr(w, 404, "user not found")
		return
	}
	link := s.linkURL(req, u.ID)
	emailed := s.maybeSendMail(ctx, u.Email, "Your Demo sign-in link",
		"Click to sign in to Demo:\n\n"+link)
	writeJSON(w, 200, map[string]any{"link": link, "emailed": emailed})
}

// magicHandler consumes a signed magic link: it issues a session for the target
// user and redirects to the dashboard.
func (s *server) magicHandler(w http.ResponseWriter, req *http.Request) {
	uid, ok := verifyLinkToken(req.URL.Query().Get("token"))
	if !ok {
		http.Error(w, "invalid or expired link", http.StatusUnauthorized)
		return
	}
	u, found := s.userByID(req.Context(), uid)
	if !found {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	id := auth.Identity{ID: u.ID, Email: u.Email, Roles: u.Roles, Permissions: u.Permissions, Guard: "api"}
	if _, err := s.auth.IssueSession(w, id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	http.Redirect(w, req, env("APP_URL", "")+"/dashboard", http.StatusFound)
}

// ---- signed links ----

func linkSecret() string {
	for _, k := range []string{"AUTH_SECRET", "APP_KEY", "DEMO_LINK_SECRET"} {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return "demo-dev-link-secret-change-me"
}

func signLinkToken(uid string, ttl time.Duration) string {
	payload := fmt.Sprintf("%s|magic|%d", uid, time.Now().Add(ttl).Unix())
	mac := hmac.New(sha256.New, []byte(linkSecret()))
	mac.Write([]byte(payload))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + sig
}

func verifyLinkToken(tok string) (string, bool) {
	parts := strings.SplitN(tok, ".", 2)
	if len(parts) != 2 {
		return "", false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", false
	}
	mac := hmac.New(sha256.New, []byte(linkSecret()))
	mac.Write(payload)
	want := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(parts[1])) {
		return "", false
	}
	f := strings.Split(string(payload), "|")
	if len(f) != 3 || f[1] != "magic" {
		return "", false
	}
	exp, _ := strconv.ParseInt(f[2], 10, 64)
	if time.Now().Unix() > exp {
		return "", false
	}
	return f[0], true
}

func (s *server) linkURL(req *http.Request, uid string) string {
	base := env("APP_URL", "")
	if base == "" {
		scheme := "http"
		if req.TLS != nil {
			scheme = "https"
		}
		base = scheme + "://" + req.Host
	}
	return base + "/magic?token=" + signLinkToken(uid, time.Hour)
}

// ---- mail / SMTP ----

type smtpConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
	From     string `json:"from"`
	Secure   bool   `json:"secure"`
}

// kvSet/kvGet persist small admin settings (SMTP config) in a dedicated table.
// VARCHAR(191) PK + portable upsert (UPDATE then INSERT) keeps it driver-agnostic.
func (s *server) kvSet(ctx context.Context, key, val string) error {
	db, ph := s.db(ctx)
	if db == nil {
		return fmt.Errorf("no database")
	}
	_, _ = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS admin_settings (k VARCHAR(191) PRIMARY KEY, v TEXT)`)
	res, err := db.ExecContext(ctx, `UPDATE admin_settings SET v=`+ph(1)+` WHERE k=`+ph(2), val, key)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		_, err = db.ExecContext(ctx, `INSERT INTO admin_settings (k,v) VALUES (`+ph(1)+`,`+ph(2)+`)`, key, val)
	}
	return err
}

func (s *server) kvGet(ctx context.Context, key string) (string, bool) {
	db, ph := s.db(ctx)
	if db == nil {
		return "", false
	}
	_, _ = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS admin_settings (k VARCHAR(191) PRIMARY KEY, v TEXT)`)
	var v string
	if err := db.QueryRowContext(ctx, `SELECT v FROM admin_settings WHERE k=`+ph(1), key).Scan(&v); err != nil {
		return "", false
	}
	return v, true
}

func (s *server) loadSMTP(ctx context.Context) (smtpConfig, bool) {
	raw, ok := s.kvGet(ctx, "smtp")
	if !ok {
		return smtpConfig{}, false
	}
	var cfg smtpConfig
	_ = json.Unmarshal([]byte(raw), &cfg)
	return cfg, cfg.Host != ""
}

func (s *server) saveSMTP(ctx context.Context, cfg smtpConfig) error {
	b, _ := json.Marshal(cfg)
	return s.kvSet(ctx, "smtp", string(b))
}

func (s *server) getMail(w http.ResponseWriter, req *http.Request) {
	cfg, _ := s.loadSMTP(req.Context())
	if cfg.Password != "" {
		cfg.Password = "••••••••"
	}
	writeJSON(w, 200, cfg)
}

func (s *server) putMail(w http.ResponseWriter, req *http.Request) {
	var cfg smtpConfig
	if err := json.NewDecoder(req.Body).Decode(&cfg); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	// Keep the existing password if the caller sent the mask.
	if cfg.Password == "" || cfg.Password == "••••••••" {
		if old, ok := s.loadSMTP(req.Context()); ok {
			cfg.Password = old.Password
		}
	}
	if err := s.saveSMTP(req.Context(), cfg); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *server) testMail(w http.ResponseWriter, req *http.Request) {
	var body struct {
		To string `json:"to"`
	}
	_ = json.NewDecoder(req.Body).Decode(&body)
	cfg, ok := s.loadSMTP(req.Context())
	if !ok {
		writeJSON(w, 200, map[string]any{"ok": false, "error": "SMTP is not configured — set host/port/from first"})
		return
	}
	if body.To == "" {
		body.To = cfg.From
	}
	if err := sendSMTP(cfg, body.To, "Demo SMTP test", "This is a test email from Demo. SMTP is working."); err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *server) maybeSendMail(ctx context.Context, to, subject, body string) bool {
	cfg, ok := s.loadSMTP(ctx)
	if !ok || to == "" {
		return false
	}
	return sendSMTP(cfg, to, subject, body) == nil
}

func sendSMTP(cfg smtpConfig, to, subject, body string) error {
	if cfg.Host == "" {
		return fmt.Errorf("smtp host not set")
	}
	port := cfg.Port
	if port == 0 {
		port = 587
	}
	addr := fmt.Sprintf("%s:%d", cfg.Host, port)
	from := cfg.From
	if from == "" {
		from = cfg.Username
	}
	msg := []byte("From: " + from + "\r\nTo: " + to + "\r\nSubject: " + subject +
		"\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + body + "\r\n")
	var smtpAuth smtp.Auth
	if cfg.Username != "" {
		smtpAuth = smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	}
	if cfg.Secure && port == 465 {
		// Implicit TLS.
		c, err := tls.Dial("tcp", addr, &tls.Config{ServerName: cfg.Host, MinVersion: tls.VersionTLS12})
		if err != nil {
			return err
		}
		defer c.Close()
		cl, err := smtp.NewClient(c, cfg.Host)
		if err != nil {
			return err
		}
		defer cl.Close()
		if smtpAuth != nil {
			if err := cl.Auth(smtpAuth); err != nil {
				return err
			}
		}
		if err := cl.Mail(from); err != nil {
			return err
		}
		if err := cl.Rcpt(to); err != nil {
			return err
		}
		wc, err := cl.Data()
		if err != nil {
			return err
		}
		if _, err := wc.Write(msg); err != nil {
			return err
		}
		return wc.Close()
	}
	return smtp.SendMail(addr, smtpAuth, from, []string{to}, msg)
}

// ---- misc ----

// genID is kept for parity with the auth plugin's id format (unused fallback).
func genID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// splitList parses a roles/permissions TEXT column that may be JSON (["a","b"])
// or a comma/space separated list.
func splitList(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return []string{}
	}
	if strings.HasPrefix(s, "[") {
		var arr []string
		if err := json.Unmarshal([]byte(s), &arr); err == nil {
			return arr
		}
	}
	parts := strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ' ' })
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

var _ = genID
