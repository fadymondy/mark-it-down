import { useEffect, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Button } from "@togo-framework/ui";
import { notesApi, type SharedNote } from "../lib/notes";
import { MarkItDownMark } from "../lib/brand";
import { APP_NAME } from "../lib/api";

// Public share viewer — /s/$slug. The backend returns pre-sanitized HTML
// (goldmark + bluemonday), so it can be injected directly.
export function Shared() {
  const { slug } = useParams({ from: "/s/$slug" });
  const [note, setNote] = useState<SharedNote | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    notesApi.shared(slug).then(setNote).catch(() => setErr(true));
  }, [slug]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <nav className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2.5">
          <MarkItDownMark size={28} className="rounded-lg" />
          <span className="font-semibold tracking-tight">{APP_NAME}</span>
        </Link>
        <Button asChild size="sm" variant="outline"><Link to="/register">Get {APP_NAME}</Link></Button>
      </nav>
      <div className="mx-auto w-full max-w-3xl px-6 pb-20">
        {err && (
          <div className="py-24 text-center text-muted-foreground">
            <p className="text-lg font-medium">This note isn't available.</p>
            <p className="mt-1 text-sm">The link may have been revoked or never existed.</p>
          </div>
        )}
        {!err && !note && <div className="py-24 text-center text-sm text-muted-foreground">Loading…</div>}
        {note && (
          <>
            <h1 className="mt-6 text-3xl font-bold tracking-tight">{note.title}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Shared note · updated {new Date(note.updated_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
            </p>
            <article className="prose dark:prose-invert mt-8 max-w-none" dangerouslySetInnerHTML={{ __html: note.html }} />
          </>
        )}
      </div>
    </main>
  );
}
