import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight, ArrowLeft, Github, Monitor, Apple, Chrome, Code2, Cloud,
  Sparkles, Table2, GitBranch, Presentation, Bot, ShieldCheck, Download,
  Palette, FileDown, Boxes,
} from "lucide-react";
import { Button, useT } from "@togo-framework/ui";
import { API, APP_NAME } from "../lib/api";
import { sessionMe, type Me } from "../lib/auth";
import { MarkItDownMark, BRAND_AMBER } from "../lib/brand";

interface UpdateAsset { name: string; url: string; size: number }
interface UpdateFeed {
  version: string;
  tag: string;
  notes_url: string;
  downloads: Record<string, UpdateAsset[]>;
}

// Install targets — each resolves its link from the unified /api/updates feed,
// with a stable fallback while the feed loads (or when no asset exists yet).
const TARGETS = [
  { key: "windows", icon: Monitor, en: "Windows", ar: "ويندوز", fallback: "https://github.com/fadymondy/mark-it-down/releases/latest" },
  { key: "mac", icon: Apple, en: "macOS", ar: "ماك", fallback: "https://github.com/fadymondy/mark-it-down/releases/latest" },
  { key: "linux", icon: Download, en: "Linux", ar: "لينكس", fallback: "https://github.com/fadymondy/mark-it-down/releases/latest" },
  { key: "vscode", icon: Code2, en: "VSCode", ar: "VSCode", fallback: "https://marketplace.visualstudio.com/items?itemName=fadymondy.mark-it-down" },
  { key: "chrome", icon: Chrome, en: "Chrome", ar: "كروم", fallback: "https://github.com/fadymondy/mark-it-down/releases/latest" },
] as const;

const FEATURES = [
  { icon: Sparkles, en: "Beautiful markdown", ar: "ماركداون جميل", descEn: "Rich rendering with live mermaid diagrams, KaTeX, and 25 hand-tuned themes.", descAr: "عرض غني مع مخططات mermaid حية و-KaTeX و25 سمة." },
  { icon: Cloud, en: "Notes warehouse", ar: "مستودع الملاحظات", descEn: "Your notes sync to the cloud — reachable from desktop, VSCode, Chrome, and this site.", descAr: "ملاحظاتك تتزامن سحابيًا — من سطح المكتب وVSCode وكروم وهذا الموقع." },
  { icon: Bot, en: "MCP for AI agents", ar: "MCP لوكلاء الذكاء", descEn: "A built-in MCP connector lets Claude and other agents read and write your notes securely.", descAr: "موصل MCP مدمج يتيح لـ Claude والوكلاء قراءة وكتابة ملاحظاتك بأمان." },
  { icon: Table2, en: "Smart tables & exports", ar: "جداول ذكية وتصدير", descEn: "Sortable data tables, Excel/CSV export, and file export to PDF, DOCX, EPUB, TXT.", descAr: "جداول قابلة للفرز وتصدير Excel/CSV وملفات PDF وDOCX وEPUB." },
  { icon: Presentation, en: "Slideshows & publishing", ar: "عروض ونشر", descEn: "Turn markdown into reveal.js slideshows or publish a static site to GitHub Pages.", descAr: "حوّل الماركداون لعروض تقديمية أو انشر موقعًا ثابتًا." },
  { icon: ShieldCheck, en: "Private by design", ar: "خصوصية بالتصميم", descEn: "Session auth with TOTP 2FA, scoped access tokens, and sanitized public sharing.", descAr: "مصادقة بجلسات مع 2FA ورموز وصول محدودة ومشاركة عامة آمنة." },
] as const;

export function Welcome() {
  const { language } = useT();
  const ar = language === "ar";
  const tx = (en: string, a: string) => (ar ? a : en);
  const Arrow = ar ? ArrowLeft : ArrowRight;

  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [feed, setFeed] = useState<UpdateFeed | null>(null);

  useEffect(() => {
    sessionMe().then(setMe).catch(() => setMe(null));
    fetch(`${API}/api/updates`).then((r) => (r.ok ? r.json() : null)).then(setFeed).catch(() => setFeed(null));
  }, []);

  return (
    <main dir={ar ? "rtl" : "ltr"} className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* brand glow — the icon's indigo, not the kit default */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem]"
        style={{ background: "radial-gradient(700px 380px at 50% -6%, rgba(59,58,122,0.45), transparent 70%)" }} />

      {/* top bar */}
      <nav className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2.5">
          <MarkItDownMark size={32} className="rounded-lg" />
          <span className="font-semibold tracking-tight">{APP_NAME}</span>
        </span>
        <span className="flex items-center gap-2">
          <a href="https://github.com/fadymondy/mark-it-down" target="_blank" rel="noopener noreferrer"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="GitHub">
            <Github className="h-5 w-5" />
          </a>
          {me === null && (
            <>
              <Button asChild variant="ghost" size="sm"><Link to="/login">{tx("Log in", "دخول")}</Link></Button>
              <Button asChild size="sm"><Link to="/register">{tx("Sign up", "حساب جديد")}</Link></Button>
            </>
          )}
          {me ? <Button asChild size="sm"><Link to="/dashboard">{tx("Dashboard", "لوحة التحكم")} <Arrow className="ms-1 h-4 w-4" /></Link></Button> : null}
        </span>
      </nav>

      <div className="mx-auto w-full max-w-5xl px-6 pb-20 pt-10 sm:pt-16">
        {/* hero */}
        <header className="text-center">
          <div className="mx-auto mb-7 w-fit drop-shadow-2xl"><MarkItDownMark size={96} className="rounded-3xl" /></div>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl">{APP_NAME}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
            {tx(
              "A beautiful markdown editor everywhere you write — desktop, VSCode, Chrome, and the cloud. One warehouse for your notes, one MCP connector for your AI agents.",
              "محرر ماركداون جميل أينما تكتب — سطح المكتب وVSCode وكروم والسحابة. مستودع واحد لملاحظاتك وموصل MCP واحد لوكلاء الذكاء الاصطناعي."
            )}
          </p>

          {/* install grid */}
          <div className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-3">
            {TARGETS.map((t) => {
              const asset = feed?.downloads?.[t.key]?.[0];
              const href = asset?.url ?? t.fallback;
              return (
                <a key={t.key} href={href} target="_blank" rel="noopener noreferrer"
                  className="group flex min-w-32 flex-col items-center gap-2 rounded-2xl border border-border bg-card px-6 py-4 transition-colors hover:border-primary/50 hover:bg-accent/40">
                  <t.icon className="h-6 w-6 transition-colors group-hover:text-primary" style={{ color: BRAND_AMBER }} />
                  <span className="text-sm font-semibold">{tx(t.en, t.ar)}</span>
                  <span className="text-xs text-muted-foreground">{asset ? tx("Download", "تنزيل") : tx("Get it", "احصل عليه")}</span>
                </a>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {feed
              ? tx(`Latest release ${feed.tag} — auto-updates on every platform.`, `أحدث إصدار ${feed.tag} — تحديث تلقائي على كل منصة.`)
              : tx("Auto-updates on every platform.", "تحديث تلقائي على كل منصة.")}
            {" "}
            <a className="text-primary hover:underline" href={feed?.notes_url ?? "https://github.com/fadymondy/mark-it-down/releases"} target="_blank" rel="noopener noreferrer">
              {tx("Release notes", "ملاحظات الإصدار")}
            </a>
          </p>
        </header>

        {/* features */}
        <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.en} className="rounded-2xl border border-border bg-card p-5 text-start">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
                  <f.icon className="h-5 w-5" />
                </span>
                <span className="font-semibold">{tx(f.en, f.ar)}</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{tx(f.descEn, f.descAr)}</p>
            </div>
          ))}
        </div>

        {/* warehouse + MCP call to action */}
        <div className="mt-16 rounded-3xl border border-border bg-card p-8 text-center sm:p-10">
          <div className="mx-auto flex w-fit items-center gap-3">
            <Boxes className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-bold tracking-tight">{tx("Your notes, everywhere", "ملاحظاتك في كل مكان")}</h2>
          </div>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            {tx(
              "Create a free account to sync notes across every app, share notes with a link, and mint access tokens that connect Claude Desktop, Claude Code, or Cursor straight to your warehouse.",
              "أنشئ حسابًا مجانيًا لمزامنة الملاحظات عبر كل التطبيقات ومشاركتها برابط وإصدار رموز وصول تربط Claude وCursor بمستودعك مباشرة."
            )}
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {me ? (
              <Button asChild size="lg"><Link to="/notes">{tx("Open my warehouse", "افتح مستودعي")} <Arrow className="ms-1 h-4 w-4" /></Link></Button>
            ) : (
              <>
                <Button asChild size="lg"><Link to="/register">{tx("Create account", "إنشاء حساب")}</Link></Button>
                <Button asChild size="lg" variant="outline"><Link to="/login">{tx("Log in", "تسجيل الدخول")}</Link></Button>
              </>
            )}
          </div>
        </div>

        {/* footer */}
        <footer className="mt-16 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Palette className="h-3.5 w-3.5" />{tx("25 themes", "25 سمة")}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1.5"><FileDown className="h-3.5 w-3.5" />{tx("PDF · DOCX · EPUB · Excel", "PDF · DOCX · EPUB · Excel")}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" />{tx("GitHub warehouse sync", "مزامنة GitHub")}</span>
          <span aria-hidden>·</span>
          <a className="hover:text-foreground" href="https://github.com/fadymondy/mark-it-down" target="_blank" rel="noopener noreferrer">MIT · Fady Mondy</a>
        </footer>
      </div>
    </main>
  );
}
