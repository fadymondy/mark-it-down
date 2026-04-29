---
name: mid:slideshow
description: Convert a Mark It Down note (or arbitrary markdown the user paste) into a reveal.js slideshow. Use when the user says "make slides from this", "turn X into a deck", "I need to present this".
---

# /mid:slideshow

Help the user turn markdown into a slide deck via the Mark It Down slideshow pipeline.

## When to invoke

- User says "make slides from this", "turn X into a deck", "I need to present this Friday"
- User asks how to format a note for a talk
- User has a draft and wants a slideshow-ready version

## What you'll do

This is a **content + workflow** skill — most of the work is reformatting the markdown so reveal.js renders it nicely. The actual slideshow generation runs in the Mark It Down VSCode extension via `markItDown.slideshow.publish` (this skill produces the input for that).

1. **Get the source markdown.**
   - If the user named a note, call `get_note` with the resolved id (use the same resolution logic as `/mid:open`).
   - If they pasted text, use that.
   - If they pointed at a file path, read it via the host (or ask them to).
2. **Audit the structure.** A good slide deck has:
   - One topic per slide
   - Short bullets (≤ 6 per slide, ≤ 8 words each)
   - Headings double as slide titles
   - Code blocks ≤ 12 lines (split if longer)
   - One image / diagram per slide max
3. **Insert slide breaks.** Use `---` on its own line between blank lines. Use `--` for vertical sub-slides when one logical idea has multiple supporting points worth stepping through.
4. **Add frontmatter** at the very top:
   ```yaml
   ---
   title: <talk title>
   theme: black     # or night / dracula / serif / white …
   transition: fade  # or slide / convex / concave / zoom / none
   ---
   ```
5. **Add speaker notes** where helpful via a `Notes:` line followed by talking points.
6. **Tell the user how to ship it.** Either:
   - Save it as a note via `/mid:new-note`, then run `Mark It Down: Slideshow: Publish` from VSCode
   - Or paste it into a fresh `.md` file in VSCode and run the same command

## Example

User: "Turn my postgres tuning note into a 4-slide deck."

You:
1. Resolve + read the note via `get_note`.
2. Restructure: slide 1 (title + problem), slide 2 (the finding), slide 3 (the SQL), slide 4 (results + next steps).
3. Add speaker notes for slides 2 and 3.
4. Output the rewritten markdown ready to paste into the extension.

## Tips

- For a talk-style deck, default to theme `night` and transition `fade`.
- For a teaching deck with code, theme `serif` reads well at lower brightness.
- Don't auto-publish — let the user review the structure first.
