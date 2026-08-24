import { useEffect, useState } from "react";
import {
  ProfileView, useT, Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
  Button, Input, Label, StatusBadge,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@togo-framework/ui";
import { Languages, ShieldCheck, KeyRound, Bot, Copy, Trash2, Plus } from "lucide-react";
import QRCode from "qrcode";
import { sessionMe, mfa, tokens, type Me, type PatMeta } from "../lib/auth";
import { useToast } from "../components/admin/toast";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ar", label: "العربية" },
] as const;

function Card({ icon: Icon, title, desc, children }: { icon: any; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4" />{title}</div>
      <p className="mb-4 text-sm text-muted-foreground">{desc}</p>
      {children}
    </div>
  );
}

// ---- Two-factor authentication ----
function TwoFactorCard({ ar, onChange }: { ar: boolean; onChange: (enrolled: boolean) => void }) {
  const tx = (en: string, a: string) => (ar ? a : en);
  const { toast } = useToast();
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauth_url: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    sessionMe().then(setMe);
    mfa.status().then((s) => { setEnrolled(s.enrolled); onChange(s.enrolled); }).catch(() => setEnrolled(false));
  }, []);

  async function begin() {
    setBusy(true);
    try {
      const res = await mfa.enroll();
      const qr = await QRCode.toDataURL(res.otpauth_url, { margin: 1, width: 192 });
      setSetup({ ...res, qr });
      setCode("");
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }

  async function activate(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await mfa.totpVerify({ userId: me?.id, code: code.trim() });
      const rec = await mfa.recoveryGenerate().catch(() => null);
      setRecovery(rec?.codes ?? null);
      setSetup(null);
      setEnrolled(true);
      onChange(true);
      toast(tx("Two-factor authentication enabled", "تم تفعيل التحقق بخطوتين"), "success");
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true);
    try {
      await mfa.disable();
      setEnrolled(false);
      onChange(false);
      toast(tx("Two-factor authentication disabled", "تم إيقاف التحقق بخطوتين"), "success");
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }

  return (
    <Card icon={ShieldCheck}
      title={tx("Two-factor authentication", "التحقق بخطوتين")}
      desc={tx("Protect your account with a 6-digit code from an authenticator app at every sign-in.", "احمِ حسابك برمز من تطبيق المصادقة عند كل تسجيل دخول.")}>
      {enrolled === null && <p className="text-sm text-muted-foreground">…</p>}

      {enrolled === false && !setup && (
        <Button onClick={begin} disabled={busy}>{tx("Enable 2FA", "تفعيل التحقق بخطوتين")}</Button>
      )}

      {setup && (
        <form onSubmit={activate} className="space-y-4">
          <div className="flex flex-col items-start gap-4 sm:flex-row">
            <img src={setup.qr} alt="TOTP QR code" className="rounded-lg border border-border bg-white p-1" />
            <div className="min-w-0 text-sm">
              <p>{tx("1. Scan the QR with Google Authenticator, 1Password, or any TOTP app.", "١. امسح الرمز بتطبيق المصادقة.")}</p>
              <p className="mt-2 text-muted-foreground">{tx("Or enter the secret manually:", "أو أدخل السر يدويًا:")}</p>
              <code className="mt-1 block truncate rounded bg-muted px-2 py-1 text-xs">{setup.secret}</code>
              <p className="mt-3">{tx("2. Enter the current code to activate:", "٢. أدخل الرمز الحالي للتفعيل:")}</p>
              <div className="mt-2 flex items-center gap-2">
                <Input className="w-32" inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required />
                <Button type="submit" disabled={busy}>{tx("Activate", "تفعيل")}</Button>
                <Button type="button" variant="ghost" onClick={() => setSetup(null)}>{tx("Cancel", "إلغاء")}</Button>
              </div>
            </div>
          </div>
        </form>
      )}

      {enrolled === true && !setup && (
        <div className="flex items-center gap-3">
          <StatusBadge tone="success">{tx("Enabled", "مفعّل")}</StatusBadge>
          <Button variant="outline" onClick={disable} disabled={busy}>{tx("Disable", "إيقاف")}</Button>
        </div>
      )}

      {/* recovery codes — shown once after activation */}
      <Dialog open={!!recovery} onOpenChange={(o) => !o && setRecovery(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tx("Save your recovery codes", "احفظ رموز الاسترداد")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {tx("Each code signs you in once if you lose your authenticator. Store them somewhere safe — they won't be shown again.",
                "كل رمز يُستخدم مرة واحدة إذا فقدت تطبيق المصادقة. احفظها بمكان آمن — لن تظهر مجددًا.")}
          </p>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-3 font-mono text-sm">
            {recovery?.map((c) => <span key={c}>{c}</span>)}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText((recovery ?? []).join("\n")).catch(() => {}); }}>
              <Copy className="me-1.5 h-4 w-4" />{tx("Copy all", "نسخ الكل")}
            </Button>
            <Button onClick={() => setRecovery(null)}>{tx("I saved them", "حفظتها")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---- Access tokens + MCP connector ----
function TokensCard({ ar }: { ar: boolean }) {
  const tx = (en: string, a: string) => (ar ? a : en);
  const { toast } = useToast();
  const [list, setList] = useState<PatMeta[]>([]);
  const [name, setName] = useState("");
  const [minted, setMinted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => tokens.list().then(setList).catch(() => setList([]));
  useEffect(() => { refresh(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await tokens.create(name.trim());
      setMinted(res.token);
      setName("");
      refresh();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }

  const mcpConfig = (token: string) => JSON.stringify(
    { mcpServers: { "mark-it-down": { type: "http", url: `${window.location.origin}/mcp`, headers: { Authorization: `Bearer ${token}` } } } },
    null, 2,
  );

  return (
    <Card icon={KeyRound}
      title={tx("Access tokens", "رموز الوصول")}
      desc={tx("Bearer tokens for the MCP connector, the Chrome extension, and scripts. A token is shown only once.", "رموز للاتصال عبر MCP وإضافة كروم والسكربتات. يظهر الرمز مرة واحدة فقط.")}>
      <form onSubmit={create} className="flex items-center gap-2">
        <Input className="w-56" placeholder={tx("Token name (e.g. claude-desktop)", "اسم الرمز")} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={busy || !name.trim()}><Plus className="me-1 h-4 w-4" />{tx("Create", "إنشاء")}</Button>
      </form>

      {list.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {list.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="font-medium">{t.name}</span>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                await tokens.revoke(t.id).catch((e: any) => toast(e.message, "error"));
                refresh();
              }}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}

      {/* one-time token reveal + ready-to-paste MCP config */}
      <Dialog open={!!minted} onOpenChange={(o) => !o && setMinted(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{tx("Token created", "تم إنشاء الرمز")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{tx("Copy it now — it won't be shown again.", "انسخه الآن — لن يظهر مجددًا.")}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{minted}</code>
            <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(minted!).catch(() => {}); toast(tx("Token copied", "نُسخ"), "success"); }}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2">
            <div className="mb-1 flex items-center gap-1.5 text-sm font-medium"><Bot className="h-4 w-4" />{tx("MCP connector (Claude Desktop / Claude Code / Cursor)", "موصل MCP")}</div>
            <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs">{minted ? mcpConfig(minted) : ""}</pre>
            <Button size="sm" variant="outline" className="mt-2" onClick={async () => { await navigator.clipboard.writeText(mcpConfig(minted!)).catch(() => {}); toast(tx("Config copied", "نُسخ الإعداد"), "success"); }}>
              <Copy className="me-1.5 h-4 w-4" />{tx("Copy MCP config", "نسخ إعداد MCP")}
            </Button>
          </div>
          <DialogFooter><Button onClick={() => setMinted(null)}>{tx("Done", "تم")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function Profile() {
  const { language, setLanguage } = useT();
  const ar = language === "ar";
  const [me, setMe] = useState<Me | null>(null);
  const [twoFactor, setTwoFactor] = useState(false);
  useEffect(() => { sessionMe().then(setMe); }, []);
  if (!me) return <div className="p-8 text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</div>;

  return (
    <div dir={ar ? "rtl" : "ltr"}>
      <ProfileView user={{ email: me.email, roles: me.roles }} language={language} twoFactorEnabled={twoFactor} sessions={[]} />

      <div className="mx-auto max-w-5xl space-y-4 px-6 pb-10">
        <TwoFactorCard ar={ar} onChange={setTwoFactor} />
        <TokensCard ar={ar} />

        {/* Language preference — switching it updates the whole UI immediately (LanguageProvider). */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold"><Languages className="h-4 w-4" />{ar ? "اللغة" : "Language"}</div>
          <p className="mb-4 text-sm text-muted-foreground">{ar ? "تغيير لغة الواجهة — يُطبّق فورًا." : "Change the interface language — applies instantly."}</p>
          <Select value={language} onValueChange={(v) => setLanguage(v as "en" | "ar")}>
            <SelectTrigger className="w-64" aria-label={ar ? "اللغة" : "Language"}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
