import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { auth, sessionMe, clearSession, type Me } from "../lib/auth";
import { API, APP_NAME } from "../lib/api";
import { MarkItDownMark } from "../lib/brand";
import { Button, Icon, Kbd, type IconName } from "../components/ui";
import { useLang } from "../lib/i18n";

// The desktop shell: titlebar (38px) · activity bar (44px) + main · statusbar.
// The activity bar is the primary nav (like VSCode / the desktop app); each
// destination fills the main area. Notes bring their own list + editor panes,
// so there is no separate app-level sidebar to nest. Admin is a distinct tab,
// shown only to admins.
export function AppLayout() {
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { t, dir } = useLang();
  const [me, setMe] = useState<Me | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    sessionMe().then(setMe);
    const es = new EventSource(`${API}/events`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    return () => es.close();
  }, []);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); nav({ to: "/notes" }); }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") { e.preventDefault(); nav({ to: "/profile" }); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") { e.preventDefault(); nav({ to: "/notes", search: { new: 1 } as any }); }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [nav]);

  const isAdmin = !!me?.roles?.includes("admin");
  const initial = (me?.email ?? "?").charAt(0).toUpperCase();
  const go = (to: string) => nav({ to });
  const active = (p: string) => pathname === p || pathname.startsWith(p + "/");

  // Primary destinations. Admin is kept in its own group (below the divider) so
  // it reads as a separate area, not part of the everyday workspace.
  const NAV: { to: string; icon: IconName; en: string; ar: string }[] = [
    { to: "/notes", icon: "bookmark", en: "Notes", ar: "الملاحظات" },
    { to: "/dashboard", icon: "columns", en: "Dashboard", ar: "لوحة التحكم" },
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
          <Link to="/" className="mid-titlebar-brand" title={APP_NAME}><MarkItDownMark size={20} /> <span className="mid-truncate">{APP_NAME}</span></Link>
        </div>
        <div className="mid-titlebar-center">
          <button className="mid-titlebar-search" title={t("Search notes (Cmd/Ctrl+K)", "بحث (Cmd/Ctrl+K)")} onClick={() => go("/notes")}>
            <span className="mid-titlebar-search-icon"><Icon name="search" size="sm" /></span>
            <span className="mid-filename">{titleFor()}</span>
            <span className="mid-titlebar-search-kbd"><Kbd>⌘K</Kbd></span>
          </button>
        </div>
        <div className="mid-titlebar-right">
          <Button variant="primary" icon="plus" onClick={() => nav({ to: "/notes", search: { new: 1 } as any })}>{t("New note", "ملاحظة جديدة")}</Button>
          <Button variant="ghost" iconOnly icon="cog" title={t("Settings (Cmd/Ctrl+,)", "الإعدادات")} onClick={() => go("/profile")} />
        </div>
      </header>

      <div className="mid-shell">
        <nav className="mid-activity-bar" aria-label="Activity bar">
          {NAV.map((a) => (
            <button key={a.to} className={`mid-activity-btn${active(a.to) ? " is-active" : ""}`} title={t(a.en, a.ar)} onClick={() => go(a.to)}>
              <Icon name={a.icon} />
            </button>
          ))}
          {isAdmin && (<>
            <span className="mid-activity-divider" />
            <button className={`mid-activity-btn${active("/admin") ? " is-active" : ""}`} title={t("Admin", "الإدارة")} onClick={() => go("/admin")}>
              <Icon name="list-ul" />
            </button>
          </>)}
          <span className="mid-activity-spacer" />
          <button className={`mid-activity-btn${active("/profile") ? " is-active" : ""}`} title={me?.email ?? t("Settings", "الإعدادات")} onClick={() => go("/profile")}>
            <span className="mid-activity-avatar">{initial}</span>
          </button>
          <button className="mid-activity-btn" title={t("Sign out", "تسجيل الخروج")} onClick={async () => { await auth.logout(); clearSession(); go("/login"); }}>
            <Icon name="x" />
          </button>
        </nav>

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
