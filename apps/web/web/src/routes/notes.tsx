import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Search, Trash2, Share2, Link2, Eye, Pencil, Save, X, FolderOpen, Tag, Cloud,
} from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  Button, Input, Label, PageHeader, StatusBadge, useT,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@togo-framework/ui";
import { notesApi, shareUrl, type Note } from "../lib/notes";
import { useToast } from "../components/admin/toast";

function renderPreview(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
}

const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function Notes() {
  const { language } = useT();
  const ar = language === "ar";
  const tx = (en: string, a: string) => (ar ? a : en);
  const { toast } = useToast();

  const [notes, setNotes] = useState<Note[]>([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<Note | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState({ title: "", body: "", category: "", tags: "" });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Note | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function refresh(query = q, cat = category) {
    const rows = await notesApi.list({ q: query || undefined, category: cat || undefined }).catch(() => []);
    setNotes(rows);
    return rows;
  }
  useEffect(() => { refresh(); }, []);

  function onSearch(v: string) {
    setQ(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => refresh(v, category), 250);
  }

  const categories = useMemo(
    () => Array.from(new Set(notes.map((n) => n.category).filter(Boolean))) as string[],
    [notes],
  );

  function open(n: Note) {
    setSelected(n);
    setMode("view");
    setDraft({ title: n.title, body: n.body, category: n.category ?? "", tags: n.tags ?? "" });
  }

  function startNew() {
    setSelected(null);
    setMode("edit");
    setDraft({ title: "", body: "", category: category || "", tags: "" });
  }

  async function save() {
    if (!draft.title.trim()) { toast(tx("Title is required", "العنوان مطلوب"), "error"); return; }
    setBusy(true);
    try {
      const payload = {
        title: draft.title.trim(),
        body: draft.body,
        category: draft.category.trim() || null,
        tags: draft.tags.trim() || null,
      };
      const saved = selected ? await notesApi.update(selected.id, payload) : await notesApi.create(payload);
      toast(tx("Note saved", "تم الحفظ"), "success");
      const rows = await refresh();
      open(rows.find((n) => n.id === saved.id) ?? saved);
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }

  async function doDelete(n: Note) {
    setBusy(true);
    try {
      await notesApi.remove(n.id);
      toast(tx("Note deleted", "تم الحذف"), "success");
      setConfirmDelete(null);
      if (selected?.id === n.id) setSelected(null);
      await refresh();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }

  async function toggleShare(n: Note) {
    setBusy(true);
    try {
      const updated = n.is_public ? await notesApi.unshare(n.id) : await notesApi.share(n.id);
      if (!n.is_public && updated.share_slug) {
        await navigator.clipboard.writeText(shareUrl(updated.share_slug)).catch(() => {});
        toast(tx("Public link copied to clipboard", "نُسخ الرابط العام"), "success");
      } else {
        toast(tx("Note is private again", "أصبحت الملاحظة خاصة"), "success");
      }
      const rows = await refresh();
      open(rows.find((x) => x.id === n.id) ?? updated);
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }

  const editorOpen = mode === "edit";

  return (
    <div dir={ar ? "rtl" : "ltr"} className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={tx("Notes warehouse", "مستودع الملاحظات")}
        description={tx("Your cloud notes — synced to desktop, VSCode, Chrome, and MCP agents.", "ملاحظاتك السحابية — متزامنة مع كل تطبيقاتك ووكلاء MCP.")}
        actions={<Button onClick={startNew}><Plus className="me-1.5 h-4 w-4" />{tx("New note", "ملاحظة جديدة")}</Button>}
      />

      <div className="flex min-h-0 flex-1 gap-0 border-t border-border">
        {/* list pane */}
        <aside className="flex w-80 shrink-0 flex-col border-e border-border">
          <div className="space-y-2 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="ps-8" placeholder={tx("Search notes…", "ابحث…")} value={q} onChange={(e) => onSearch(e.target.value)} />
            </div>
            {categories.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${category === "" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                  onClick={() => { setCategory(""); refresh(q, ""); }}>
                  {tx("All", "الكل")}
                </button>
                {categories.map((c) => (
                  <button key={c}
                    className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${category === c ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                    onClick={() => { setCategory(c); refresh(q, c); }}>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {notes.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                <Cloud className="mx-auto mb-2 h-8 w-8 opacity-40" />
                {tx("No notes yet — create your first one.", "لا ملاحظات بعد — أنشئ أول واحدة.")}
              </div>
            )}
            {notes.map((n) => (
              <button key={n.id} onClick={() => open(n)}
                className={`block w-full border-b border-border/60 px-4 py-3 text-start transition-colors hover:bg-accent/40 ${selected?.id === n.id ? "bg-accent/60" : ""}`}>
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{n.title}</span>
                  {n.is_public && <Share2 className="h-3 w-3 shrink-0 text-primary" />}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  {n.category && <span className="inline-flex items-center gap-1"><FolderOpen className="h-3 w-3" />{n.category}</span>}
                  <span>{fmtDate(n.updated_at)}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* detail pane */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!selected && !editorOpen && (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              {tx("Select a note, or create a new one.", "اختر ملاحظة أو أنشئ جديدة.")}
            </div>
          )}

          {(selected || editorOpen) && (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  {editorOpen ? (
                    <Input className="h-8 w-72 font-medium" placeholder={tx("Note title", "العنوان")} value={draft.title}
                      onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} autoFocus />
                  ) : (
                    <>
                      <h2 className="truncate font-semibold">{selected!.title}</h2>
                      {selected!.is_public && <StatusBadge tone="success">{tx("Public", "عام")}</StatusBadge>}
                    </>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {editorOpen ? (
                    <>
                      <Button size="sm" onClick={save} disabled={busy}><Save className="me-1 h-4 w-4" />{tx("Save", "حفظ")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => (selected ? setMode("view") : setSelected(null))}><X className="h-4 w-4" /></Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setMode("edit")}><Pencil className="me-1 h-4 w-4" />{tx("Edit", "تحرير")}</Button>
                      <Button size="sm" variant="outline" onClick={() => toggleShare(selected!)} disabled={busy}>
                        {selected!.is_public ? <><X className="me-1 h-4 w-4" />{tx("Unshare", "إلغاء المشاركة")}</> : <><Share2 className="me-1 h-4 w-4" />{tx("Share", "مشاركة")}</>}
                      </Button>
                      {selected!.is_public && selected!.share_slug && (
                        <Button size="sm" variant="ghost" onClick={async () => {
                          await navigator.clipboard.writeText(shareUrl(selected!.share_slug!)).catch(() => {});
                          toast(tx("Link copied", "نُسخ الرابط"), "success");
                        }}><Link2 className="h-4 w-4" /></Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(selected!)}><Trash2 className="h-4 w-4" /></Button>
                    </>
                  )}
                </div>
              </div>

              {editorOpen ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex items-center gap-3 border-b border-border px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                      <Input className="h-7 w-40 text-xs" placeholder={tx("Category", "التصنيف")} value={draft.category}
                        onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                      <Input className="h-7 w-56 text-xs" placeholder={tx("tags, comma, separated", "وسوم مفصولة بفواصل")} value={draft.tags}
                        onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
                    <textarea
                      className="min-h-0 w-full resize-none border-e border-border bg-background p-4 font-mono text-sm outline-none"
                      placeholder={tx("Write markdown…", "اكتب ماركداون…")}
                      value={draft.body}
                      onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                      dir="ltr"
                    />
                    <div className="hidden min-h-0 overflow-auto p-4 lg:block">
                      <div className="flex items-center gap-1.5 pb-3 text-xs text-muted-foreground"><Eye className="h-3.5 w-3.5" />{tx("Preview", "معاينة")}</div>
                      <article className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: renderPreview(draft.body) }} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto p-6">
                  <article className="prose dark:prose-invert max-w-3xl" dangerouslySetInnerHTML={{ __html: renderPreview(selected!.body) }} />
                  <div className="mt-8 flex items-center gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
                    {selected!.category && <span className="inline-flex items-center gap-1"><FolderOpen className="h-3 w-3" />{selected!.category}</span>}
                    {selected!.tags && <span className="inline-flex items-center gap-1"><Tag className="h-3 w-3" />{selected!.tags}</span>}
                    <span>{tx("Updated", "آخر تحديث")} {fmtDate(selected!.updated_at)}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* delete confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tx("Delete note?", "حذف الملاحظة؟")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {tx(`"${confirmDelete?.title}" will be permanently removed from your warehouse.`, `سيتم حذف "${confirmDelete?.title}" نهائيًا.`)}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>{tx("Cancel", "إلغاء")}</Button>
            <Button variant="destructive" onClick={() => doDelete(confirmDelete!)} disabled={busy}>{tx("Delete", "حذف")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
