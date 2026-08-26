import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { API, APP_NAME } from "../lib/api";
import { sessionMe, type Me } from "../lib/auth";
import { MarkItDownMark } from "../lib/brand";
import { Button, Icon, Kbd, type IconName } from "../components/ui";
import { useLang } from "../lib/i18n";
import { useTheme } from "../lib/theme";

interface UpdateAsset { name: string; url: string; size: number }
interface UpdateFeed { version: string; tag: string; notes_url: string; downloads: Record<string, UpdateAsset[]> }

// Install targets resolve their link from the unified /api/updates feed, with a
// stable fallback while the feed loads (or when no asset exists yet).
const TARGETS: { key: string; icon: IconName; en: string; ar: string; fallback: string }[] = [
  { key: "windows", icon: "download", en: "Windows", ar: "ويندوز", fallback: "https://github.com/fadymondy/mark-it-down/releases/latest" },
  { key: "mac", icon: "download", en: "macOS", ar: "ماك", fallback: "https://github.com/fadymondy/mark-it-down/releases/latest" },
  { key: "linux", icon: "download", en: "Linux", ar: "لينكس", fallback: "https://github.com/fadymondy/mark-it-down/releases/latest" },
  { key: "android", icon: "markdown", en: "Android", ar: "أندرويد", fallback: "https://markitdown.fadymondy.com/mark-it-down-v0.3.0.apk" },
  { key: "ios", icon: "markdown", en: "iOS", ar: "iOS", fallback: "" },
  { key: "vscode", icon: "code", en: "VSCode", ar: "VSCode", fallback: "https://marketplace.visualstudio.com/items?itemName=fadymondy.mark-it-down" },
  { key: "chrome", icon: "link", en: "Chrome", ar: "كروم", fallback: "https://github.com/fadymondy/mark-it-down/releases/latest" },
];

const FEATURES: { icon: IconName; en: string; ar: string; descEn: string; descAr: string }[] = [
  { icon: "markdown", en: "Beautiful markdown", ar: "ماركداون جميل", descEn: "Rich rendering with live mermaid diagrams, KaTeX, and 25 hand-tuned themes.", descAr: "عرض غني مع مخططات mermaid حية و-KaTeX و25 سمة." },
  { icon: "bookmark", en: "Notes warehouse", ar: "مستودع الملاحظات", descEn: "Your notes sync to the cloud — reachable from desktop, VSCode, Chrome, and this site.", descAr: "ملاحظاتك تتزامن سحابيًا — من سطح المكتب وVSCode وكروم وهذا الموقع." },
  { icon: "code", en: "MCP for AI agents", ar: "MCP لوكلاء الذكاء", descEn: "A built-in MCP connector lets Claude and other agents read and write your notes securely.", descAr: "موصل MCP مدمج يتيح لـ Claude والوكلاء قراءة وكتابة ملاحظاتك بأمان." },
  { icon: "list-ul", en: "Smart tables & exports", ar: "جداول ذكية وتصدير", descEn: "Sortable data tables, Excel/CSV export, and file export to PDF, DOCX, EPUB, TXT.", descAr: "جداول قابلة للفرز وتصدير Excel/CSV وملفات PDF وDOCX وEPUB." },
  { icon: "columns", en: "Slideshows & publishing", ar: "عروض ونشر", descEn: "Turn markdown into reveal.js slideshows or publish a static site to GitHub Pages.", descAr: "حوّل الماركداون لعروض تقديمية أو انشر موقعًا ثابتًا." },
  { icon: "lock", en: "Private by design", ar: "خصوصية بالتصميم", descEn: "Session auth with TOTP 2FA, scoped access tokens, and sanitized public sharing.", descAr: "مصادقة بجلسات مع 2FA ورموز وصول محدودة ومشاركة عامة آمنة." },
];

export function Welcome() {
  const { t } = useLang();
  const { isDark, setMode } = useTheme();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [feed, setFeed] = useState<UpdateFeed | null>(null);

  useEffect(() => {
    sessionMe().then(setMe).catch(() => setMe(null));
    fetch(`${API}/api/updates`).then((r) => (r.ok ? r.json() : null)).then(setFeed).catch(() => setFeed(null));
  }, []);

  return (
    <div className="mid-landing">
      <nav className="mid-landing-nav">
        <Link to="/" className="mid-titlebar-brand"><MarkItDownMark size={22} /> {APP_NAME}</Link>
        <div className="mid-landing-nav-actions">
          <Button variant="ghost" iconOnly icon={isDark ? "show" : "show"} title={t("Toggle light/dark", "تبديل الوضع")} onClick={() => setMode(isDark ? "light" : "dark")} />
          <a href="https://github.com/fadymondy/mark-it-down" target="_blank" rel="noopener noreferrer"><Button variant="ghost" iconOnly icon="github" title="GitHub" /></a>
          {me === null && (<>
            <Link to="/login"><Button variant="ghost">{t("Log in", "دخول")}</Button></Link>
            <Link to="/register"><Button variant="primary">{t("Sign up", "حساب جديد")}</Button></Link>
          </>)}
          {me ? <Link to="/notes"><Button variant="primary" icon="bookmark">{t("Open warehouse", "افتح المستودع")}</Button></Link> : null}
        </div>
      </nav>

      <section className="mid-welcome mid-anim-fade-up">
        <div className="mid-welcome-glyph"><MarkItDownMark size={84} /></div>
        <h1 className="mid-welcome-title">{APP_NAME}</h1>
        <p className="mid-welcome-tagline">
          {t("A beautiful markdown editor everywhere you write — desktop, VSCode, Chrome, and the cloud. One warehouse for your notes, one MCP connector for your AI agents.",
             "محرر ماركداون جميل أينما تكتب — سطح المكتب وVSCode وكروم والسحابة. مستودع واحد لملاحظاتك وموصل MCP واحد لوكلاء الذكاء الاصطناعي.")}
        </p>
        <div className="mid-welcome-actions mid-stagger">
          {TARGETS.map((x) => {
            const asset = feed?.downloads?.[x.key]?.[0];
            const href = asset?.url ?? x.fallback;
            if (!href) {
              return (
                <span key={x.key} className="mid-welcome-action" style={{ opacity: 0.55, cursor: "default" }}>
                  <Icon name={x.icon} />
                  <span className="mid-welcome-action-label">{t(x.en, x.ar)}</span>
                  <span className="mid-welcome-action-kbd">{t("soon", "قريبًا")}</span>
                </span>
              );
            }
            return (
              <a key={x.key} className="mid-welcome-action mid-pressable" href={href} target="_blank" rel="noopener noreferrer">
                <Icon name={x.icon} />
                <span className="mid-welcome-action-label">{t(x.en, x.ar)}</span>
                <span className="mid-welcome-action-kbd">{asset ? feed?.tag : t("get", "احصل")}</span>
              </a>
            );
          })}
        </div>
        <p className="mid-welcome-note">
          {feed ? t(`Latest release ${feed.tag} — auto-updates on every platform.`, `أحدث إصدار ${feed.tag} — تحديث تلقائي على كل منصة.`) : t("Auto-updates on every platform.", "تحديث تلقائي على كل منصة.")}{" "}
          <a href={feed?.notes_url ?? "https://github.com/fadymondy/mark-it-down/releases"} target="_blank" rel="noopener noreferrer">{t("Release notes", "ملاحظات الإصدار")}</a>
          {" · "}<Kbd>⌘K</Kbd> {t("search anywhere in the app", "بحث في أي مكان بالتطبيق")}
        </p>
      </section>

      <section className="mid-feature-grid mid-stagger">
        {FEATURES.map((f) => (
          <div key={f.en} className="mid-feature mid-hover-raise">
            <div className="mid-feature-head"><Icon name={f.icon} />{t(f.en, f.ar)}</div>
            <p>{t(f.descEn, f.descAr)}</p>
          </div>
        ))}
      </section>

      <footer className="mid-landing-footer">
        <span>25 themes</span><span>·</span><span>PDF · DOCX · EPUB · Excel</span><span>·</span><span>GitHub warehouse sync</span><span>·</span>
        <a href="https://github.com/fadymondy/mark-it-down" target="_blank" rel="noopener noreferrer">MIT · Fady Mondy</a>
      </footer>
    </div>
  );
}
