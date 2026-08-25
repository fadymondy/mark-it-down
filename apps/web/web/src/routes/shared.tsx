import { useEffect, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { notesApi, type SharedNote } from "../lib/notes";
import { MarkItDownMark } from "../lib/brand";
import { APP_NAME } from "../lib/api";
import { Button, Icon } from "../components/ui";

// Public share viewer — /s/$slug. The backend returns pre-sanitized HTML
// (goldmark + bluemonday), rendered with the same reading styles as the desktop preview.
export function Shared() {
  const { slug } = useParams({ from: "/s/$slug" });
  const [note, setNote] = useState<SharedNote | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { notesApi.shared(slug).then(setNote).catch(() => setErr(true)); }, [slug]);

  return (
    <div className="mid-landing">
      <nav className="mid-landing-nav">
        <Link to="/" className="mid-titlebar-brand"><MarkItDownMark size={22} /> {APP_NAME}</Link>
        <div className="mid-landing-nav-actions">
          <Link to="/register"><Button variant="primary" icon="download">Get {APP_NAME}</Button></Link>
        </div>
      </nav>
      <main className="mid-preview">
        {err && (
          <div className="mid-empty"><div><Icon name="lock" /><div>This note isn't available.</div><div className="mid-subtle">The link may have been revoked or never existed.</div></div></div>
        )}
        {!err && !note && <div className="mid-empty"><span className="mid-spinner" /></div>}
        {note && (
          <article className="mid-md">
            <h1>{note.title}</h1>
            <p className="mid-muted mid-mono">Shared note · updated {new Date(note.updated_at).toLocaleDateString(undefined, { dateStyle: "medium" })}</p>
            <div dangerouslySetInnerHTML={{ __html: note.html }} />
          </article>
        )}
      </main>
    </div>
  );
}
