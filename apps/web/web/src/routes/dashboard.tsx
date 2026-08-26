import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { sessionMe, type Me } from "../lib/auth";
import { notesApi, type Note } from "../lib/notes";
import { metaResources, adminList, type ResourceMeta } from "../lib/admin";
import { Button, Group, Icon, Row, fmtDate } from "../components/ui";
import { useLang } from "../lib/i18n";

const labelOf = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function Dashboard() {
  const { t } = useLang();
  const [me, setMe] = useState<Me | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [counts, setCounts] = useState<{ meta: ResourceMeta; count: number }[]>([]);

  useEffect(() => {
    sessionMe().then(setMe);
    notesApi.list().then(setNotes).catch(() => setNotes([]));
  }, []);
  useEffect(() => {
    if (!me?.roles?.includes("admin")) return;
    metaResources().then(async (ms) => {
      const all = await Promise.all(ms.map(async (m) => ({ meta: m, count: (await adminList(m.table).catch(() => [])).length })));
      setCounts(all);
    }).catch(() => {});
  }, [me]);

  if (!me) return <div className="mid-empty"><span className="mid-spinner" /></div>;

  const shared = notes.filter((n) => n.is_public).length;
  const categories = new Set(notes.map((n) => n.category).filter(Boolean)).size;
  const week = notes.filter((n) => Date.now() - new Date(n.updated_at).getTime() < 7 * 864e5).length;
  const recent = [...notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6);

  return (
    <div className="mid-page">
      <div className="mid-page-head">
        <div>
          <h1 className="mid-page-title">{t("Dashboard", "لوحة التحكم")}</h1>
          <p className="mid-page-subtitle">{t(`Welcome back, ${me.email}`, `مرحبًا بعودتك، ${me.email}`)}</p>
        </div>
        <Link to="/notes" search={{ new: 1 } as any}><Button variant="primary" icon="plus">{t("New note", "ملاحظة جديدة")}</Button></Link>
      </div>
      <div className="mid-settings-form">
        <div className="mid-stat-grid mid-stagger">
          <div className="mid-stat mid-hover-raise"><div className="mid-stat-label">{t("Notes", "الملاحظات")}</div><div className="mid-stat-value">{notes.length}</div><div className="mid-stat-hint">{t("in your warehouse", "في مستودعك")}</div></div>
          <div className="mid-stat mid-hover-raise"><div className="mid-stat-label">{t("Updated this week", "حُدّثت هذا الأسبوع")}</div><div className="mid-stat-value">{week}</div><div className="mid-stat-hint">{t("last 7 days", "آخر 7 أيام")}</div></div>
          <div className="mid-stat mid-hover-raise"><div className="mid-stat-label">{t("Categories", "التصنيفات")}</div><div className="mid-stat-value">{categories}</div></div>
          <div className="mid-stat mid-hover-raise"><div className="mid-stat-label">{t("Shared publicly", "مشاركة عامة")}</div><div className="mid-stat-value">{shared}</div></div>
        </div>

        <Group title={t("Recent notes", "أحدث الملاحظات")} icon="bookmark" flush>
          {recent.length === 0 ? <p className="mid-settings-empty" style={{ padding: "var(--mid-space-4) var(--mid-space-5)" }}>{t("No notes yet — create your first one.", "لا ملاحظات بعد.")}</p> : (
            <div className="mid-table-wrap"><table className="mid-table"><thead><tr><th>{t("Title", "العنوان")}</th><th>{t("Category", "التصنيف")}</th><th>{t("Updated", "آخر تحديث")}</th><th></th></tr></thead>
              <tbody>{recent.map((n) => (
                <tr key={n.id}><td><span className="mid-row"><Icon name="markdown" size="sm" className="mid-icon--muted" />{n.title}</span></td><td className="is-mono">{n.category ?? "—"}</td><td className="is-mono">{fmtDate(n.updated_at)}</td>
                  <td>{n.is_public && <span className="mid-chip mid-chip--accent"><Icon name="link" size="sm" />{t("shared", "مشاركة")}</span>}</td></tr>
              ))}</tbody></table></div>
          )}
        </Group>

        <Group title={t("Connect your apps", "اربط تطبيقاتك")} icon="code" description={t("The same warehouse from desktop, VSCode, Chrome, and AI agents.", "نفس المستودع من سطح المكتب وVSCode وكروم ووكلاء الذكاء.")}>
          <Row label={t("MCP connector", "موصل MCP")} description={t("Mint an access token in Settings and paste the generated config into Claude Desktop, Claude Code, or Cursor.", "أنشئ رمز وصول من الإعدادات وألصق الإعداد في Claude أو Cursor.")}><Link to="/profile"><Button icon="cog">{t("Open Settings", "افتح الإعدادات")}</Button></Link></Row>
          <Row label={t("Desktop, VSCode & Chrome", "سطح المكتب وVSCode وكروم")} description={t("Install links are on the home page and update automatically.", "روابط التثبيت في الصفحة الرئيسية وتُحدّث تلقائيًا.")}><Link to="/"><Button icon="download">{t("Downloads", "التنزيلات")}</Button></Link></Row>
        </Group>

        {counts.length > 0 && (
          <Group title={t("Resources", "الموارد")} icon="list-ul" description={t("Record counts per registered resource (admin).", "عدد السجلات لكل مورد (للمدير).")}>
            <div className="mid-stat-grid mid-stagger">
              {counts.map(({ meta, count }) => (
                <Link key={meta.table} to="/admin/$resource" params={{ resource: meta.table }} className="mid-stat mid-hover-raise" style={{ textDecoration: "none", color: "inherit" }}>
                  <div className="mid-stat-label">{labelOf(meta.name || meta.table)}</div><div className="mid-stat-value">{count}</div>
                </Link>
              ))}
            </div>
          </Group>
        )}
      </div>
    </div>
  );
}
