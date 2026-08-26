import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { notesApi, shareUrl, type Note } from "../lib/notes";
import { Button, Icon, Input, Modal, useToast, fmtDate } from "../components/ui";
import { useLang } from "../lib/i18n";

type Mode = "view" | "split" | "edit";
const render = (md: string) => DOMPurify.sanitize(marked.parse(md, { async: false }) as string);

// Warehouse notes — mirrors the desktop app and the mobile app: a notes-list
// pane on the left and an editor/preview on the right, with the View / Split /
// Edit segmented toggle. On narrow screens it becomes a master → detail flow
// (list, tap a note to open the editor, Back returns to the list), so the list
// is never hidden the way a plain sidebar would be.
export function Notes() {
  const { t } = useLang();
  const { toast } = useToast();
  const search = useSearch({ strict: false }) as { new?: number };
  const [notes, setNotes] = useState<Note[]>([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<Note | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState({ title: "", body: "", category: "", tags: "" });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  // On mobile, whether the detail (editor) pane is showing over the list.
  const [detailOpen, setDetailOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Note | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function refresh(query = q, cat = category) {
    const rows = await notesApi.list({ q: query || undefined, category: cat || undefined }).catch(() => []);
    setNotes(rows);
    return rows;
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (search?.new) startNew(); /* eslint-disable-next-line */ }, [search?.new]);

  const categories = useMemo(() => Array.from(new Set(notes.map((n) => n.category).filter(Boolean))) as string[], [notes]);

  function open(n: Note) {
    setSelected(n); setMode("view"); setDirty(false); setDetailOpen(true);
    setDraft({ title: n.title, body: n.body, category: n.category ?? "", tags: n.tags ?? "" });
  }
  function startNew() {
    setSelected(null); setMode("edit"); setDirty(true); setDetailOpen(true);
    setDraft({ title: "", body: "", category: category || "", tags: "" });
  }
  function edit<K extends keyof typeof draft>(k: K, v: string) { setDraft((d) => ({ ...d, [k]: v })); setDirty(true); }

  async function save() {
    if (!draft.title.trim()) { toast(t("Title is required", "العنوان مطلوب"), "error"); return; }
    setBusy(true);
    try {
      const payload = { title: draft.title.trim(), body: draft.body, category: draft.category.trim() || null, tags: draft.tags.trim() || null };
      const saved = selected ? await notesApi.update(selected.id, payload) : await notesApi.create(payload);
      const rows = await refresh();
      const fresh = rows.find((n) => n.id === saved.id) ?? saved;
      setSelected(fresh); setDirty(false); setMode("view");
      toast(t("Saved", "تم الحفظ"));
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }
  async function doDelete(n: Note) {
    setBusy(true);
    try {
      await notesApi.remove(n.id); setConfirmDelete(null);
      if (selected?.id === n.id) { setSelected(null); setMode("view"); setDetailOpen(false); }
      await refresh(); toast(t("Note deleted", "تم الحذف"));
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }
  async function toggleShare(n: Note) {
    setBusy(true);
    try {
      const updated = n.is_public ? await notesApi.unshare(n.id) : await notesApi.share(n.id);
      if (!n.is_public && updated.share_slug) { await navigator.clipboard.writeText(shareUrl(updated.share_slug)).catch(() => {}); toast(t("Public link copied", "نُسخ الرابط العام")); }
      else toast(t("Note is private again", "أصبحت الملاحظة خاصة"));
      const rows = await refresh(); setSelected(rows.find((x) => x.id === n.id) ?? updated);
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && (selected || mode !== "view")) { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", fn); return () => window.removeEventListener("keydown", fn);
  });

  const showEditor = selected || mode !== "view";
  const html = useMemo(() => render(mode === "view" ? (selected?.body ?? "") : draft.body), [mode, selected?.body, draft.body]);

  return (
    <div className={`mid-notes-workspace${detailOpen ? " show-detail" : ""}`}>
      {/* List pane */}
      <aside className="mid-notes-pane">
        <div className="mid-sidebar-header">
          <input className="mid-table-filter" type="search" placeholder={t("Filter notes…", "تصفية الملاحظات…")} value={q}
            onChange={(e) => { setQ(e.target.value); clearTimeout(timer.current); timer.current = setTimeout(() => refresh(e.target.value, category), 250); }} />
          <Button variant="ghost" iconOnly icon="plus" title={t("New note", "ملاحظة جديدة")} onClick={startNew} />
        </div>
        {categories.length > 0 && (
          <div className="mid-notes-types" role="tablist">
            <button className={`mid-notes-type${category === "" ? " is-active" : ""}`} onClick={() => { setCategory(""); refresh(q, ""); }}>{t("All", "الكل")}</button>
            {categories.map((c) => <button key={c} className={`mid-notes-type${category === c ? " is-active" : ""}`} onClick={() => { setCategory(c); refresh(q, c); }}>{c}</button>)}
          </div>
        )}
        <div className="mid-notes-list">
          {notes.length === 0 && (
            <div className="mid-empty"><div><Icon name="bookmark" />{t("No notes yet — create your first one.", "لا ملاحظات بعد — أنشئ أول واحدة.")}</div></div>
          )}
          {notes.map((n) => (
            <button key={n.id} className={`mid-note-row${selected?.id === n.id ? " is-active" : ""}`} onClick={() => open(n)}>
              <span className="mid-note-type-chip"><Icon name="markdown" size="sm" /></span>
              <span className="mid-note-title">{n.title}</span>
              <span className="mid-note-meta">
                <span>{fmtDate(n.updated_at)}</span>
                {n.category && <span className="mid-truncate">· {n.category}</span>}
                {n.tags && <span className="mid-note-tags">{n.tags.split(",").slice(0, 3).map((tag) => <span key={tag} className="mid-note-tag">{tag.trim()}</span>)}</span>}
              </span>
              {n.is_public && <span className="mid-note-share" title={t("Shared publicly", "مشاركة عامة")}><Icon name="link" size="sm" /></span>}
            </button>
          ))}
        </div>
      </aside>

      {/* Detail pane (editor / preview) */}
      <div className="mid-notes-detail">
        {showEditor ? (
          <div className="mid-editor-area">
            <div className="mid-tabstrip" role="tablist">
              <button className="mid-btn mid-btn--icon mid-btn--ghost mid-notes-back" title={t("Back to list", "العودة للقائمة")}
                onClick={() => { setDetailOpen(false); if (!selected) setMode("view"); }}>
                <Icon name="chevron-right" className="mid-flip-x" />
              </button>
              <button className="mid-tab is-active" role="tab">
                <Icon name="markdown" size="sm" />
                <span className="mid-tab-title">{(mode === "view" ? selected?.title : draft.title) || t("Untitled", "بدون عنوان")}{dirty ? " •" : ""}</span>
              </button>
              <div className="mid-tab-actions">
                <div className="mid-mode-toggle" role="tablist" aria-label="Render mode">
                  <button className={`mid-mode-seg${mode === "view" ? " is-active" : ""}`} title={t("View", "عرض")} onClick={() => setMode("view")} disabled={!selected}><Icon name="show" size="sm" /></button>
                  <button className={`mid-mode-seg${mode === "split" ? " is-active" : ""}`} title={t("Split", "مقسّم")} onClick={() => setMode("split")}><Icon name="columns" size="sm" /></button>
                  <button className={`mid-mode-seg${mode === "edit" ? " is-active" : ""}`} title={t("Edit", "تحرير")} onClick={() => setMode("edit")}><Icon name="edit" size="sm" /></button>
                </div>
                {selected && (<>
                  <Button variant="ghost" iconOnly icon="link" title={selected.is_public ? t("Unshare", "إلغاء المشاركة") : t("Share publicly", "مشاركة عامة")} onClick={() => toggleShare(selected)} disabled={busy} />
                  {selected.is_public && selected.share_slug && <Button variant="ghost" iconOnly icon="copy" title={t("Copy link", "نسخ الرابط")} onClick={async () => { await navigator.clipboard.writeText(shareUrl(selected.share_slug!)).catch(() => {}); toast(t("Link copied", "نُسخ الرابط")); }} />}
                  <Button variant="ghost" iconOnly icon="trash" title={t("Delete", "حذف")} onClick={() => setConfirmDelete(selected)} />
                </>)}
                <Button variant="primary" icon="save" busy={busy} disabled={!dirty} onClick={save} title="Cmd/Ctrl+S">{t("Save", "حفظ")}</Button>
              </div>
            </div>

            {mode !== "view" && (
              <div className="mid-editor-meta">
                <input className="mid-settings-control mid-editor-title" placeholder={t("Note title", "عنوان الملاحظة")} value={draft.title} onChange={(e) => edit("title", e.target.value)} autoFocus={!selected} />
                <Input placeholder={t("Category", "التصنيف")} value={draft.category} onChange={(e) => edit("category", e.target.value)} />
                <Input placeholder={t("tags, comma, separated", "وسوم مفصولة بفواصل")} value={draft.tags} onChange={(e) => edit("tags", e.target.value)} />
              </div>
            )}

            <div className={`mid-editor-body${mode === "split" ? " is-split" : ""}`}>
              {mode !== "view" && <textarea className="mid-editor-textarea" dir="ltr" spellCheck={false} placeholder={t("Write markdown…", "اكتب ماركداون…")} value={draft.body} onChange={(e) => edit("body", e.target.value)} />}
              {mode !== "edit" && (
                <div className="mid-preview">
                  <article className="mid-md">
                    {mode === "view" && selected && <h1>{selected.title}</h1>}
                    <div dangerouslySetInnerHTML={{ __html: html }} />
                    {mode === "view" && selected && (
                      <p className="mid-muted mid-mono" style={{ marginTop: "var(--mid-space-8)" }}>
                        {selected.category ? `${selected.category} · ` : ""}{selected.tags ? `${selected.tags} · ` : ""}{t("updated", "آخر تحديث")} {fmtDate(selected.updated_at)}
                      </p>
                    )}
                  </article>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mid-empty">
            <div>
              <Icon name="markdown" />
              <div>{t("Select a note, or create a new one.", "اختر ملاحظة أو أنشئ جديدة.")}</div>
              <div style={{ marginTop: "var(--mid-space-3)" }}><Button variant="primary" icon="plus" onClick={startNew}>{t("New note", "ملاحظة جديدة")}</Button></div>
            </div>
          </div>
        )}
      </div>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title={t("Delete note?", "حذف الملاحظة؟")}
        footer={<><span className="mid-frame-spacer" /><Button onClick={() => setConfirmDelete(null)}>{t("Cancel", "إلغاء")}</Button><Button variant="destructive" icon="trash" busy={busy} onClick={() => doDelete(confirmDelete!)}>{t("Delete", "حذف")}</Button></>}>
        <p>{t(`"${confirmDelete?.title}" will be permanently removed from your warehouse.`, `سيتم حذف "${confirmDelete?.title}" نهائيًا.`)}</p>
      </Modal>
    </div>
  );
}
