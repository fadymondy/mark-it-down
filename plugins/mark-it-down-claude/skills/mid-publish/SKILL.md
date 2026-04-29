---
name: mid:publish
description: Publish a Mark It Down note to the configured GitHub Pages warehouse. Use when the user says "share this publicly", "publish this note", "make this a public page".
---

# /mid:publish

Walk the user through publishing a note via the Mark It Down publish pipeline (F10).

## When to invoke

- User says "share this", "publish that", "make it public", "give me a URL for this"
- User has a note they want to surface to a colleague / blog / wiki
- User asks how to publish

## Important

This skill **does not push directly** — the publish pipeline is host-side (VSCode extension) because it touches git, gh CLI, and the local working clone of the warehouse repo. The Claude side prepares the note + tells the user the exact command to run.

## What you'll do

1. **Verify warehouse + publish are configured.** Ask the user to confirm:
   - `markItDown.warehouse.repo` is set to a public GitHub repo they own
   - `markItDown.publish.enabled` is `true`
   - GitHub Pages is enabled for that repo (Settings → Pages)

   If unsure, point them at `Mark It Down: Warehouse: Open on GitHub` to inspect the repo, and at `Mark It Down: Publish: Open Site in Browser` to verify the site root resolves.
2. **Decide the source.** If publishing a stored note, resolve the id via `/mid:open` flow. If publishing the active VSCode editor, the user just needs to focus that editor.
3. **Tell them the command.** Pick one:
   - `Mark It Down: Publish: Deploy Current Page` — publishes only the active editor's markdown to `<publish-branch>/<publish-path>/<basename>.html`
   - `Mark It Down: Publish: Deploy Site` — full rebuild of all global notes
4. **Provide the resulting URL.** Compute it: `https://<owner>.github.io/<repo>/<publish-path>/<slug>-<id>.html` (slug = title slugified). Share this so the user can verify the deploy lands at the right place.
5. **Offer follow-ups.** "Want me to draft a tweet / Slack message linking it?" "Want me to add a 'Published' note to your warehouse Index?"

## Example

User: "Publish my postgres tuning note publicly."

You:
1. Resolve note via `get_note`. Note id `ka9zsb1tfnd2`, title slug `postgres-tuning-pooler-index-hint-cuts-p99-by-200ms`.
2. Confirm warehouse `you/your-notes` is public + Pages-enabled.
3. Tell user: "Run `Mark It Down: Publish: Deploy Site` from the command palette. Your note will land at:"
4. URL: `https://you.github.io/your-notes/notes/postgres-tuning-pooler-index-hint-cuts-p99-by-200ms-ka9zsb1tfnd2.html`
5. Offer to draft a sharing message.

## Failure modes

- **Warehouse repo is private** → Pages serves 404. Tell the user to make it public OR move the publish target to a different repo.
- **Pages not enabled** → URL returns 404 even if the branch exists. Direct them to repo Settings → Pages → Source: deploy from branch → `gh-pages`.
- **Publish disabled** → tell them to flip `markItDown.publish.enabled = true`.
