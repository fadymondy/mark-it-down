import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { auth, sessionMe, clearSession, type Me } from "../lib/auth";
import { metaResources, type ResourceMeta } from "../lib/admin";
import { API, APP_NAME } from "../lib/api";
import { MarkItDownMark } from "../lib/brand";
import { Button, Icon, Kbd, type IconName } from "../components/ui";
import { useLang } from "../lib/i18n";

// The desktop shell, one-to-one: titlebar (38px) · activity bar (44px) + sidebar
// (240px) + main · statusbar (24px). Same class names as apps/electron/renderer.
export function AppLayout() {
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { t, dir } = useLang();
  const [me, setMe] = useState<Me | null>(null);
  const [resources, setResources] = useState<ResourceMeta[]>([]);
  const [live, setLive] = useState(false);
  const [sidebar, setSidebar] = useState(true);

  useEffect(() => {
    sessionMe().then(setMe);
    metaResources().then(setResources).catch(() => setResources([]));
    const es = new EventSource(`${API}/events`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    return () => es.close();
  }, []);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); nav({ to: "/notes" }); }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") { e.preventDefault(); nav({ to: "/profile" }); }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [nav]);

  const isAdmin = !!me?.roles?.includes("admin");
  const initial = (me?.email ?? "?").charAt(0).toUpperCase();
  const go = (to: string) => nav({ to });
  const active = (p: string) => pathname === p || pathname.startsWith(p + "/");

  const ACTIVITY: { to: string; icon: IconName; en: string; ar: string; admin?: boolean }[] = [
    { to: "/notes", icon: "bookmark", en: "Notes", ar: "الملاحظات" },
    { to: "/dashboard", icon: "columns", en: "Dashboard", ar: "لوحة التحكم" },
    { to: "/admin", icon: "list-ul", en: "Admin", ar: "الإدارة", admin: true },
  ];

  const titleFor = () => {
    if (active("/notes")) return t("Notes warehouse", "مستودع الملاحظات");
    if (active("/dashboard")) return t("Dashboard", "لوحة التحكم");
    if (active("/admin")) return t("Admin", "الإدارة");
    if (active("/profile")) return t("Settings", "الإعدادات");
    return APP_NAME;
  };

  return (
    <div className="mid-app" dir={dir}>
      <header className="mid-titlebar" role="toolbar">
        <div className="mid-titlebar-left">
          <Link to="/" className="mid-titlebar-brand" title={APP_NAME}><MarkItDownMark size={20} /></Link>
          <Button variant="ghost" iconOnly icon="columns" title={t("Toggle sidebar", "إظهار/إخفاء الشريط")} onClick={() => setSidebar((v) => !v)} />
        </div>
        <div className="mid-titlebar-center">
          <button className="mid-titlebar-search" title={t("Search notes (Cmd/Ctrl+K)", "بحث (Cmd/Ctrl+K)")} onClick={() => go("/notes")}>
            <span className="mid-titlebar-search-icon"><Icon name="search" size="sm" /></span>
            <span className="mid-filename">{titleFor()}</span>
            <span className="mid-titlebar-search-kbd"><Kbd>⌘K</Kbd></span>
          </button>
        </div>
        <div className="mid-titlebar-right">
          <Button variant="ghost" iconOnly icon="cog" title={t("Settings (Cmd/Ctrl+,)", "الإعدادات")} onClick={() => go("/profile")} />
        </div>
      </header>

      <div className={`mid-shell${sidebar ? " has-sidebar" : ""}`}>
        <nav className="mid-activity-bar" aria-label="Activity bar">
          {ACTIVITY.filter((a) => !a.admin || isAdmin).map((a) => (
            <button key={a.to} className={`mid-activity-btn${active(a.to) ? " is-active" : ""}`} title={t(a.en, a.ar)} onClick={() => go(a.to)}>
              <Icon name={a.icon} />
            </button>
          ))}
          <span className="mid-activity-spacer" />
          <button className={`mid-activity-btn${active("/profile") ? " is-active" : ""}`} title={me?.email ?? ""} onClick={() => go("/profile")}>
            <span className="mid-activity-avatar">{initial}</span>
          </button>
          <button className="mid-activity-btn" title={t("Sign out", "تسجيل الخروج")} onClick={async () => { await auth.logout(); clearSession(); go("/login"); }}>
            <Icon name="x" />
          </button>
        </nav>

        {sidebar && (
          <aside className="mid-sidebar">
            <div className="mid-sidebar-header">
              <span className="mid-sidebar-title">{APP_NAME}</span>
              <Button variant="ghost" iconOnly icon="plus" title={t("New note", "ملاحظة جديدة")} onClick={() => nav({ to: "/notes", search: { new: 1 } as any })} />
            </div>
            <div className="mid-sidebar-body">
              <div className="mid-sidebar-section">{t("Workspace", "مساحة العمل")}</div>
              <button className={`mid-list-row${active("/notes") ? " is-active" : ""}`} onClick={() => go("/notes")}><Icon name="bookmark" />{t("Notes", "الملاحظات")}</button>
              <button className={`mid-list-row${active("/dashboard") ? " is-active" : ""}`} onClick={() => go("/dashboard")}><Icon name="columns" />{t("Dashboard", "لوحة التحكم")}</button>
              <button className={`mid-list-row${active("/profile") ? " is-active" : ""}`} onClick={() => go("/profile")}><Icon name="cog" />{t("Settings", "الإعدادات")}</button>
              {isAdmin && (<>
                <div className="mid-sidebar-section">{t("Admin", "الإدارة")}</div>
                <button className={`mid-list-row${pathname === "/admin" ? " is-active" : ""}`} onClick={() => go("/admin")}><Icon name="list-ul" />{t("Users & mail", "المستخدمون والبريد")}</button>
                {resources.map((r) => (
                  <button key={r.table} className={`mid-list-row${active(`/admin/${r.table}`) ? " is-active" : ""}`} onClick={() => go(`/admin/${r.table}`)}>
                    <Icon name="file" /><span className="mid-truncate" style={{ textTransform: "capitalize" }}>{r.name || r.table}</span>
                  </button>
                ))}
              </>)}
            </div>
          </aside>
        )}

        <main className="mid-main"><Outlet /></main>
      </div>

      <footer className="mid-statusbar">
        <span className="mid-status-cell"><span className={`mid-status-dot${live ? "" : " is-off"}`}>●</span>{live ? t("Realtime connected", "متصل مباشرة") : t("Offline", "غير متصل")}</span>
        <span className="mid-status-spacer" />
        <span className="mid-status-cell">{me?.email ?? "…"}</span>
        <button className="mid-status-cell mid-status-cell--button" onClick={() => go("/profile")}><Icon name="cog" size="sm" />{t("Settings", "الإعدادات")}</button>
      </footer>
    </div>
  );
}
