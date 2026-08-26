// Package mcpsrv exposes the Mark It Down warehouse as an authenticated MCP
// server over Streamable HTTP at /mcp. Tool names mirror the desktop/VSCode
// stdio server (src/mcp/server.ts) so agent-side prompts work against either
// transport. Callers authenticate with a bearer PAT minted at
// POST /api/auth/tokens (or a browser session); every tool is scoped to the
// authenticated user's notes.
package mcpsrv

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	auth "github.com/togo-framework/auth"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/mark-it-down/apps/web/internal/app"
	"github.com/fadymondy/mark-it-down/apps/web/internal/models"
)

// Mount wires the MCP endpoint onto the kernel router behind the auth plugin's
// strict middleware (session cookie or bearer PAT).
func Mount(k *togo.Kernel, a *app.App, authsvc *auth.Service) {
	srv := mcp.NewServer(&mcp.Implementation{Name: "mark-it-down", Version: appVersion}, nil)
	registerTools(srv, a)

	stream := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return srv }, nil)
	endpoint := authsvc.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		stream.ServeHTTP(w, r)
	}))
	k.Router.Handle("/mcp", endpoint)

	// Tell MCP clients how to authenticate (RFC 9728-style hint).
	k.Router.Get("/.well-known/oauth-protected-resource", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		base := "https://" + r.Host
		if r.TLS == nil {
			base = "http://" + r.Host
		}
		fmt.Fprintf(w, `{"resource":%q,"bearer_methods_supported":["header"]}`, base+"/mcp")
	})
}

const appVersion = "0.3.0"

func who(ctx context.Context) (*auth.Identity, error) {
	id, ok := auth.IdentityFrom(ctx)
	if !ok || id == nil {
		return nil, fmt.Errorf("unauthorized")
	}
	return id, nil
}

func registerTools(srv *mcp.Server, a *app.App) {
	type listArgs struct {
		Category string `json:"category,omitempty" jsonschema:"filter by exact category"`
		Tag      string `json:"tag,omitempty" jsonschema:"filter by tag"`
	}
	addTool(srv, "list_notes", "List the user's warehouse notes (id, title, category, tags, updated_at).",
		func(ctx context.Context, in listArgs) (string, error) {
			id, err := who(ctx)
			if err != nil {
				return "", err
			}
			q := models.Notes(a).Where("user_id", "=", id.ID).Order("updated_at DESC").Limit(500)
			if in.Category != "" {
				q = q.Where("category", "=", in.Category)
			}
			rows, err := q.Get(ctx)
			if err != nil {
				return "", err
			}
			var b strings.Builder
			for _, r := range rows {
				tags := ""
				if r.Tags != nil {
					tags = *r.Tags
				}
				if in.Tag != "" && !hasTag(tags, in.Tag) {
					continue
				}
				cat := ""
				if r.Category != nil {
					cat = *r.Category
				}
				fmt.Fprintf(&b, "%s\t%s\tcategory=%s\ttags=%s\tupdated=%s\n",
					r.ID, r.Title, cat, tags, r.UpdatedAt.Format("2006-01-02 15:04"))
			}
			if b.Len() == 0 {
				return "no notes found", nil
			}
			return b.String(), nil
		})

	type getArgs struct {
		ID string `json:"id" jsonschema:"the note id"`
	}
	addTool(srv, "get_note", "Read a note's full markdown body by id.",
		func(ctx context.Context, in getArgs) (string, error) {
			id, err := who(ctx)
			if err != nil {
				return "", err
			}
			row, err := models.Notes(a).Find(ctx, in.ID)
			if err != nil {
				return "", err
			}
			if row == nil || row.UserID != id.ID {
				return "", fmt.Errorf("note not found")
			}
			return fmt.Sprintf("# %s\n\n%s", row.Title, row.Body), nil
		})

	type createArgs struct {
		Title    string `json:"title" jsonschema:"note title"`
		Body     string `json:"body" jsonschema:"markdown body"`
		Category string `json:"category,omitempty" jsonschema:"optional category path"`
		Tags     string `json:"tags,omitempty" jsonschema:"optional comma-separated tags"`
	}
	addTool(srv, "create_note", "Create a new markdown note in the user's warehouse.",
		func(ctx context.Context, in createArgs) (string, error) {
			id, err := who(ctx)
			if err != nil {
				return "", err
			}
			if strings.TrimSpace(in.Title) == "" {
				return "", fmt.Errorf("title is required")
			}
			data := map[string]any{
				"title": in.Title, "body": in.Body, "user_id": id.ID, "is_public": false,
			}
			if in.Category != "" {
				data["category"] = in.Category
			}
			if in.Tags != "" {
				data["tags"] = in.Tags
			}
			row, err := models.Notes(a).Create(ctx, data)
			if err != nil {
				return "", err
			}
			a.Emit(ctx, "note.created", row)
			return "created note " + row.ID, nil
		})

	type updateArgs struct {
		ID       string `json:"id" jsonschema:"the note id"`
		Title    string `json:"title,omitempty" jsonschema:"new title (unchanged when empty)"`
		Body     string `json:"body,omitempty" jsonschema:"new markdown body (unchanged when empty)"`
		Category string `json:"category,omitempty" jsonschema:"new category (unchanged when empty)"`
		Tags     string `json:"tags,omitempty" jsonschema:"new comma-separated tags (unchanged when empty)"`
	}
	addTool(srv, "update_note", "Update a note's title, body, category, or tags.",
		func(ctx context.Context, in updateArgs) (string, error) {
			id, err := who(ctx)
			if err != nil {
				return "", err
			}
			row, err := models.Notes(a).Find(ctx, in.ID)
			if err != nil {
				return "", err
			}
			if row == nil || row.UserID != id.ID {
				return "", fmt.Errorf("note not found")
			}
			data := map[string]any{}
			if in.Title != "" {
				data["title"] = in.Title
			}
			if in.Body != "" {
				data["body"] = in.Body
			}
			if in.Category != "" {
				data["category"] = in.Category
			}
			if in.Tags != "" {
				data["tags"] = in.Tags
			}
			if len(data) == 0 {
				return "nothing to update", nil
			}
			if err := models.Notes(a).Where("id", "=", in.ID).Update(ctx, data); err != nil {
				return "", err
			}
			a.Emit(ctx, "note.updated", in.ID)
			return "updated note " + in.ID, nil
		})

	addTool(srv, "delete_note", "Delete a note by id.",
		func(ctx context.Context, in getArgs) (string, error) {
			id, err := who(ctx)
			if err != nil {
				return "", err
			}
			row, err := models.Notes(a).Find(ctx, in.ID)
			if err != nil {
				return "", err
			}
			if row == nil || row.UserID != id.ID {
				return "", fmt.Errorf("note not found")
			}
			if err := models.Notes(a).Where("id", "=", in.ID).Delete(ctx); err != nil {
				return "", err
			}
			a.Emit(ctx, "note.deleted", in.ID)
			return "deleted note " + in.ID, nil
		})

	type searchArgs struct {
		Query string `json:"query" jsonschema:"free-text search over titles, bodies, and tags"`
	}
	addTool(srv, "search_notes", "Search the user's notes by free text.",
		func(ctx context.Context, in searchArgs) (string, error) {
			id, err := who(ctx)
			if err != nil {
				return "", err
			}
			needle := strings.ToLower(strings.TrimSpace(in.Query))
			if needle == "" {
				return "", fmt.Errorf("query is required")
			}
			rows, err := models.Notes(a).Where("user_id", "=", id.ID).
				Order("updated_at DESC").Limit(1000).Get(ctx)
			if err != nil {
				return "", err
			}
			var b strings.Builder
			for _, r := range rows {
				tags := ""
				if r.Tags != nil {
					tags = *r.Tags
				}
				if strings.Contains(strings.ToLower(r.Title), needle) ||
					strings.Contains(strings.ToLower(r.Body), needle) ||
					strings.Contains(strings.ToLower(tags), needle) {
					fmt.Fprintf(&b, "%s\t%s\tupdated=%s\n", r.ID, r.Title, r.UpdatedAt.Format("2006-01-02 15:04"))
				}
			}
			if b.Len() == 0 {
				return "no matches", nil
			}
			return b.String(), nil
		})
}

// addTool registers a typed tool whose string result becomes the text content.
func addTool[In any](srv *mcp.Server, name, description string, fn func(context.Context, In) (string, error)) {
	type toolText struct {
		Text string `json:"text"`
	}
	mcp.AddTool(srv, &mcp.Tool{Name: name, Description: description},
		func(ctx context.Context, _ *mcp.CallToolRequest, in In) (*mcp.CallToolResult, toolText, error) {
			out, err := fn(ctx, in)
			if err != nil {
				return nil, toolText{}, err
			}
			return &mcp.CallToolResult{
				Content: []mcp.Content{&mcp.TextContent{Text: out}},
			}, toolText{Text: out}, nil
		})
}

// hasTag reports whether the comma-separated tags column contains tag.
func hasTag(tags, tag string) bool {
	for _, t := range strings.Split(tags, ",") {
		if strings.EqualFold(strings.TrimSpace(t), tag) {
			return true
		}
	}
	return false
}
