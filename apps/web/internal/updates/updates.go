// Package updates serves the unified auto-update / install feed for every
// Mark It Down surface. GitHub Releases is the single source of truth (the
// desktop app's electron-updater already publishes there); this endpoint
// classifies release assets per platform so the landing page, the Chrome
// extension's update checker, and the VSCode extension's release checker all
// read one URL instead of each hitting the GitHub API:
//
//	GET /api/updates                → full feed (version + all platforms)
//	GET /api/updates/{platform}     → best asset for windows|mac|linux|vscode|chrome
//	GET /api/updates/{platform}?redirect=1 → 302 to the asset download
package updates

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/togo-framework/togo"
)

const cacheTTL = 10 * time.Minute

type asset struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	Size int64  `json:"size"`
}

type feed struct {
	Version     string             `json:"version"`
	Tag         string             `json:"tag"`
	PublishedAt string             `json:"published_at"`
	NotesURL    string             `json:"notes_url"`
	Downloads   map[string][]asset `json:"downloads"`
}

type service struct {
	repo string // owner/name

	mu        sync.Mutex
	cached    *feed
	fetchedAt time.Time
}

// Mount registers the update-feed routes on the kernel router.
func Mount(k *togo.Kernel) {
	repo := os.Getenv("UPDATES_REPO")
	if repo == "" {
		repo = "fadymondy/mark-it-down"
	}
	s := &service{repo: repo}
	k.Router.Get("/api/updates", s.handleFeed)
	k.Router.Get("/api/updates/{platform}", s.handlePlatform)
}

func (s *service) handleFeed(w http.ResponseWriter, r *http.Request) {
	f, err := s.feed(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_ = json.NewEncoder(w).Encode(f)
}

func (s *service) handlePlatform(w http.ResponseWriter, r *http.Request) {
	platform := strings.ToLower(chi.URLParam(r, "platform"))
	f, err := s.feed(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	assets, ok := f.Downloads[platform]
	if !ok || len(assets) == 0 {
		http.Error(w, `{"error":"no asset for platform"}`, http.StatusNotFound)
		return
	}
	if r.URL.Query().Get("redirect") == "1" {
		http.Redirect(w, r, assets[0].URL, http.StatusFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"version": f.Version, "tag": f.Tag, "published_at": f.PublishedAt,
		"notes_url": f.NotesURL, "asset": assets[0], "assets": assets,
	})
}

func (s *service) feed(r *http.Request) (*feed, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cached != nil && time.Since(s.fetchedAt) < cacheTTL {
		return s.cached, nil
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet,
		"https://api.github.com/repos/"+s.repo+"/releases/latest", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "mark-it-down-updates")
	if tok := os.Getenv("UPDATES_GITHUB_TOKEN"); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		if s.cached != nil {
			return s.cached, nil // serve stale over failing
		}
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		if s.cached != nil {
			return s.cached, nil
		}
		return nil, fmt.Errorf("github releases: %s", resp.Status)
	}
	var rel struct {
		TagName     string `json:"tag_name"`
		PublishedAt string `json:"published_at"`
		HTMLURL     string `json:"html_url"`
		Assets      []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
			Size               int64  `json:"size"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, err
	}
	f := &feed{
		Version:     strings.TrimPrefix(rel.TagName, "v"),
		Tag:         rel.TagName,
		PublishedAt: rel.PublishedAt,
		NotesURL:    rel.HTMLURL,
		Downloads:   map[string][]asset{},
	}
	for _, a := range rel.Assets {
		p := classify(a.Name)
		if p == "" {
			continue
		}
		f.Downloads[p] = append(f.Downloads[p], asset{Name: a.Name, URL: a.BrowserDownloadURL, Size: a.Size})
	}
	s.cached, s.fetchedAt = f, time.Now()
	return f, nil
}

// classify maps a release asset filename to an install platform. Preferred
// installers sort first because handlePlatform serves assets[0].
func classify(name string) string {
	n := strings.ToLower(name)
	switch {
	case strings.HasSuffix(n, ".exe"):
		return "windows"
	case strings.HasSuffix(n, ".dmg"):
		return "mac"
	case strings.HasSuffix(n, ".appimage"), strings.HasSuffix(n, ".deb"):
		return "linux"
	case strings.HasSuffix(n, ".vsix"):
		return "vscode"
	case strings.Contains(n, "chrome") && strings.HasSuffix(n, ".zip"):
		return "chrome"
	case strings.HasSuffix(n, "-mac.zip"), strings.Contains(n, "mac.zip"):
		return "mac"
	default:
		return ""
	}
}

func writeErr(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadGateway)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}
