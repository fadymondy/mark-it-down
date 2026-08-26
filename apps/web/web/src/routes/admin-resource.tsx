// Admin → generic resource browser (/admin/$resource). Columns come from the
// resource schema; rows are server-paged (adminListPaged) and refreshed over SSE.
// Same design system as the desktop app (mid-* classes only).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { Alert, Button, Chip, Icon, Input, Modal, fmtDate, useToast } from "../components/ui";
import { useLang } from "../lib/i18n";
import { adminDelete, adminListPaged, controlFor, formatValue, resourceFields, type PagedResult, type ResourceField } from "../lib/admin";
import { ResourceForm } from "../components/admin/ResourceForm";
import { Infolist } from "../components/admin/Infolist";
import { API } from "../lib/api";

type Row = Record<string, any>;
type Mode = "create" | "edit" | "view" | "delete";
type Sort = { id: string; desc: boolean } | null;
type Query = { for: string; page: number; sort: Sort };

const PAGE_SIZE = 20;
const labelOf = (name: string) => name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function AdminResource() {
  const { resource } = useParams({ strict: false }) as { resource: string };
  const { t, lang, dir } = useLang();
  const { toast } = useToast();
  const single = labelOf(resource.replace(/s$/, ""));

  const [result, setResult] = useState<PagedResult | null>(null);
  const [fields, setFields] = useState<ResourceField[]>([]);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");
  const [modal, setModal] = useState<{ mode: Mode; row?: Row } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Paging/sort state is keyed on the resource so switching resources resets it
  // without an extra render + fetch.
  const [query, setQuery] = useState<Query>({ for: resource, page: 1, sort: null });
  const active: Query = query.for === resource ? query : { for: resource, page: 1, sort: null };
  useEffect(() => { if (query.for !== resource) setQuery({ for: resource, page: 1, sort: null }); }, [query.for, resource]);
  const { page, sort } = active;

  const refresh = useCallback(async () => {
    try {
      const r = await adminListPaged(resource, { page, pageSize: PAGE_SIZE, sort: sort?.id, order: sort ? (sort.desc ? "desc" : "asc") : undefined });
      setResult(r); setErr("");
    } catch (e: any) {
      setResult({ items: [], total: 0, page, pageSize: PAGE_SIZE });
      setErr(e?.message || String(e));
    }
  }, [resource, page, sort]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    setResult(null); setFilter(""); setModal(null); setFields([]);
    let alive = true;
    resourceFields(resource).then((f) => { if (alive) setFields(f); });
    const es = new EventSource(`${API}/events`);
    es.onmessage = () => refreshRef.current();
    return () => { alive = false; es.close(); };
  }, [resource]);
  useEffect(() => { refresh(); }, [refresh]);

  // Client-side filter over the current page's string fields.
  const rows = useMemo(() => {
    const all = result?.items ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => String(r.id ?? "").toLowerCase().includes(q) || Object.values(r).some((v) => typeof v === "string" && v.toLowerCase().includes(q)));
  }, [result, filter]);

  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const setPage = (p: number) => setQuery({ for: resource, page: Math.min(Math.max(1, p), pages), sort });
  const toggleSort = (id: string) => setQuery({ for: resource, page: 1, sort: sort?.id === id ? (sort.desc ? null : { id, desc: true }) : { id, desc: false } });
  const close = useCallback(() => setModal(null), []);

  async function del() {
    if (!modal?.row) return;
    setDeleting(true);
    try {
      await adminDelete(resource, String(modal.row.id));
      setModal(null); toast(t("Deleted", "تم الحذف")); await refresh();
    } catch (e: any) { toast(e?.message || String(e), "error"); }
    finally { setDeleting(false); }
  }

  const sortMark = (id: string) => (sort?.id === id ? (sort.desc ? " ↓" : " ↑") : "");

  return (
    <div className="mid-page mid-page--wide" dir={dir}>
      <div className="mid-page-head">
        <div>
          <h1 className="mid-page-title">{labelOf(resource)}</h1>
          <p className="mid-page-subtitle">{total} {t("records", "سجل")} · <span className="mid-mono">/api/{resource}</span></p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setModal({ mode: "create" })}>{t("New", "جديد")}</Button>
      </div>

      <div className="mid-stack">
        <Alert tone="danger">{err}</Alert>

        <div className="mid-row">
          <Icon name="search" className="mid-icon--muted" />
          <Input className="mid-grow" value={filter} placeholder={t("Filter this page…", "تصفية هذه الصفحة…")} onChange={(e) => setFilter(e.target.value)} />
          <Button variant="ghost" icon="refresh" onClick={() => refresh()}>{t("Refresh", "تحديث")}</Button>
          <Button variant="ghost" icon="download" disabled={rows.length === 0} onClick={() => exportRows(rows, resource)}>{t("Export", "تصدير")}</Button>
        </div>

        <section className="mid-settings-group">
          <div className="mid-table-wrap">
            <table className="mid-table">
              <thead>
                <tr>
                  <th onClick={() => toggleSort("id")} role="button">id{sortMark("id")}</th>
                  {fields.map((f) => <th key={f.name} onClick={() => toggleSort(f.name)} role="button">{labelOf(f.name)}{sortMark(f.name)}</th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {result === null ? (
                  <tr><td colSpan={fields.length + 2}><div className="mid-empty">{t("Loading…", "جارٍ التحميل…")}</div></td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={fields.length + 2}><div className="mid-empty"><Icon name="folder-open" />{filter ? t("No rows match the filter.", "لا توجد صفوف مطابقة.") : t("No records yet.", "لا توجد سجلات بعد.")}</div></td></tr>
                ) : rows.map((r) => (
                  <tr key={String(r.id)} onClick={() => setModal({ mode: "view", row: r })}>
                    <td className="is-mono">#{String(r.id)}</td>
                    {fields.map((f) => <td key={f.name}><Cell f={f} v={r[f.name]} lang={lang} /></td>)}
                    <td>
                      <div className="mid-row-actions">
                        <Button variant="ghost" iconOnly icon="show" aria-label={t("View", "عرض")} title={t("View", "عرض")} onClick={(e) => { e.stopPropagation(); setModal({ mode: "view", row: r }); }} />
                        <Button variant="ghost" iconOnly icon="edit" aria-label={t("Edit", "تعديل")} title={t("Edit", "تعديل")} onClick={(e) => { e.stopPropagation(); setModal({ mode: "edit", row: r }); }} />
                        <Button variant="ghost" iconOnly icon="trash" aria-label={t("Delete", "حذف")} title={t("Delete", "حذف")} onClick={(e) => { e.stopPropagation(); setModal({ mode: "delete", row: r }); }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mid-table-footer">
            <span>
              {total === 0 ? t("No records", "لا توجد سجلات") : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} ${t("of", "من")} ${total}`}
              {filter && result ? ` · ${rows.length} ${t("shown", "معروض")}` : ""}
            </span>
            <span className="mid-row">
              <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("Previous", "السابق")}</Button>
              <span className="mid-mono">{page} / {pages}</span>
              <Button variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t("Next", "التالي")}</Button>
            </span>
          </div>
        </section>
      </div>

      {/* Create / edit — schema form (validates + submits itself). */}
      <Modal open={modal?.mode === "create" || modal?.mode === "edit"} onClose={close}
        title={`${modal?.mode === "edit" ? t("Edit", "تعديل") : t("New", "إضافة")} ${single}`}>
        {modal && (modal.mode === "create" || modal.mode === "edit") ? (
          <ResourceForm table={resource} fields={fields} row={modal.mode === "edit" ? modal.row : undefined} onCancel={close}
            onSaved={(mode) => { setModal(null); toast(mode === "edit" ? t("Updated", "تم التحديث") : t("Created", "تم الإنشاء")); refresh(); }} />
        ) : null}
      </Modal>

      {/* View — infolist. */}
      <Modal open={modal?.mode === "view"} onClose={close} title={`${single} #${modal?.row?.id ?? ""}`}
        footer={<>
          <Button variant="secondary" onClick={close}>{t("Close", "إغلاق")}</Button>
          <Button variant="primary" icon="edit" onClick={() => modal?.row && setModal({ mode: "edit", row: modal.row })}>{t("Edit", "تعديل")}</Button>
        </>}>
        {modal?.row ? <Infolist row={modal.row} fields={fields} /> : null}
      </Modal>

      {/* Delete confirmation. */}
      <Modal open={modal?.mode === "delete"} onClose={close} title={t("Delete record", "حذف السجل")}
        footer={<>
          <Button variant="secondary" onClick={close}>{t("Cancel", "إلغاء")}</Button>
          <Button variant="destructive" icon="trash" busy={deleting} onClick={del}>{t("Delete", "حذف")}</Button>
        </>}>
        <Alert tone="danger">{t("This action cannot be undone.", "لا يمكن التراجع عن هذا الإجراء.")}</Alert>
        <p className="mid-settings-empty">{t("Delete", "حذف")} {single} <span className="mid-mono">#{String(modal?.row?.id ?? "")}</span>?</p>
      </Modal>
    </div>
  );
}

function Cell({ f, v, lang }: { f: ResourceField; v: any; lang: string }) {
  const c = controlFor(f);
  if (v === null || v === undefined || v === "") return <span className="mid-subtle">—</span>;
  if (c === "switch" || typeof v === "boolean") {
    const on = v === true || v === "true";
    return <Chip tone={on ? "ok" : undefined}>{on ? "Yes" : "No"}</Chip>;
  }
  if (c === "select") return <Chip tone="accent">{String(v)}</Chip>;
  if (c === "relation") return <span className="mid-mono">#{String(v)}</span>;
  if (c === "date" || c === "datetime") {
    const d = new Date(v);
    return <span>{isNaN(d.getTime()) ? String(v) : fmtDate(String(v))}</span>;
  }
  const text = formatValue(f, v, lang);
  return <span title={text}>{text.length > 80 ? `${text.slice(0, 80)}…` : text}</span>;
}

/** Export rows as a CSV download. */
function exportRows(rows: Row[], name: string) {
  if (!rows.length) return;
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(typeof r[c] === "object" && r[c] !== null ? JSON.stringify(r[c]) : r[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(url);
}
