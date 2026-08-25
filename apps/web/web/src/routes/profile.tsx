import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { auth, sessionMe, mfa, tokens, type Me, type PatMeta } from "../lib/auth";
import { Alert, Button, Chip, Field, Group, Icon, Input, Modal, Row, useToast } from "../components/ui";
import { useLang } from "../lib/i18n";
import { useTheme, THEMES, type ThemeMode } from "../lib/theme";

// Settings — the desktop's settings page structure (group cards, setting rows,
// mode pills, theme swatches) applied to account, appearance, security, tokens.
export function Profile() {
  const { t, lang, setLang } = useLang();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { sessionMe().then(setMe); }, []);
  if (!me) return <div className="mid-empty"><span className="mid-spinner" /></div>;

  return (
    <div className="mid-page">
      <div className="mid-page-head">
        <div>
          <h1 className="mid-page-title">{t("Settings", "الإعدادات")}</h1>
          <p className="mid-page-subtitle">{t("Customize your workspace", "خصّص مساحة عملك")}</p>
        </div>
      </div>
      <div className="mid-settings-form">
        <Group title={t("Account", "الحساب")} icon="lock" description={me.email}>
          <Row label={t("Roles", "الأدوار")} description={t("Admins can manage users and resources.", "يستطيع المدراء إدارة المستخدمين والموارد.")}>
            <span className="mid-row">{(me.roles?.length ? me.roles : ["user"]).map((r) => <Chip key={r} tone={r === "admin" ? "accent" : undefined}>{r}</Chip>)}</span>
          </Row>
          <PasswordRow />
        </Group>

        <AppearanceGroup />

        <Group title={t("Language", "اللغة")} icon="book" description={t("Change the interface language — applies instantly.", "تغيير لغة الواجهة — يُطبّق فورًا.")}>
          <div className="mid-mode-pills">
            <button className={`mid-mode-pill${lang === "en" ? " is-active" : ""}`} onClick={() => setLang("en")}>English</button>
            <button className={`mid-mode-pill${lang === "ar" ? " is-active" : ""}`} onClick={() => setLang("ar")}>العربية</button>
          </div>
        </Group>

        <TwoFactorGroup me={me} />
        <TokensGroup />
      </div>
    </div>
  );
}

function PasswordRow() {
  const { t } = useLang();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(""); const [next, setNext] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await auth.changePassword(cur, next); setOpen(false); setCur(""); setNext(""); toast(t("Password changed", "تم تغيير كلمة المرور")); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Row label={t("Password", "كلمة المرور")} description={t("Change the password you sign in with.", "غيّر كلمة المرور الخاصة بتسجيل الدخول.")}>
      <Button icon="edit" onClick={() => setOpen(true)}>{t("Change", "تغيير")}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("Change password", "تغيير كلمة المرور")}
        footer={<><span className="mid-frame-spacer" /><Button onClick={() => setOpen(false)}>{t("Cancel", "إلغاء")}</Button><Button variant="primary" type="submit" form="pw-form" busy={busy} icon="save">{t("Save", "حفظ")}</Button></>}>
        <form id="pw-form" onSubmit={submit} className="mid-form">
          <Alert tone="danger">{err}</Alert>
          <Field label={t("Current password", "كلمة المرور الحالية")}><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></Field>
          <Field label={t("New password", "كلمة المرور الجديدة")} help={t("At least 8 characters.", "8 أحرف على الأقل.")}><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} /></Field>
        </form>
      </Modal>
    </Row>
  );
}

function AppearanceGroup() {
  const { t } = useLang();
  const { mode, setMode } = useTheme();
  const base: { id: ThemeMode; en: string; ar: string }[] = [
    { id: "auto", en: "System", ar: "النظام" }, { id: "light", en: "Light", ar: "فاتح" }, { id: "dark", en: "Dark", ar: "داكن" }, { id: "sepia", en: "Sepia", ar: "بُنّي" },
  ];
  return (
    <Group title={t("Appearance", "المظهر")} icon="image" description={t("Same themes as the desktop app — the choice applies everywhere in this browser.", "نفس سمات تطبيق سطح المكتب — يُطبّق الاختيار على هذا المتصفح.")}>
      <div className="mid-mode-pills">
        {base.map((b) => <button key={b.id} className={`mid-mode-pill${mode === b.id ? " is-active" : ""}`} onClick={() => setMode(b.id)}>{t(b.en, b.ar)}</button>)}
      </div>
      <Row inline={false} label={t("Named themes", "السمات")} description={t("25 hand-tuned palettes from the desktop and VSCode editors.", "25 لوحة ألوان من محرري سطح المكتب وVSCode.")}>
        <div className="mid-theme-grid">
          {THEMES.map((th) => (
            <button key={th.id} className={`mid-theme-swatch${mode === `theme:${th.id}` ? " is-active" : ""}`} onClick={() => setMode(`theme:${th.id}`)} title={th.label}>
              <span className="mid-theme-swatch-dot" style={{ background: `linear-gradient(135deg, ${th.palette.bg} 50%, ${th.palette.accent} 50%)` }} />
              <span className="mid-truncate">{th.label}</span>
            </button>
          ))}
        </div>
      </Row>
    </Group>
  );
}

function TwoFactorGroup({ me }: { me: Me }) {
  const { t } = useLang();
  const { toast } = useToast();
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauth_url: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { mfa.status().then((s) => setEnrolled(s.enrolled)).catch(() => setEnrolled(false)); }, []);

  async function begin() {
    setBusy(true);
    try { const res = await mfa.enroll(); setSetup({ ...res, qr: await QRCode.toDataURL(res.otpauth_url, { margin: 1, width: 176 }) }); setCode(""); }
    catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }
  async function activate(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await mfa.totpVerify({ userId: me.id, code: code.trim() });
      const rec = await mfa.recoveryGenerate().catch(() => null);
      setRecovery(rec?.codes ?? null); setSetup(null); setEnrolled(true);
      toast(t("Two-factor authentication enabled", "تم تفعيل التحقق بخطوتين"));
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true);
    try { await mfa.disable(); setEnrolled(false); toast(t("Two-factor authentication disabled", "تم إيقاف التحقق بخطوتين")); }
    catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }

  return (
    <Group title={t("Two-factor authentication", "التحقق بخطوتين")} icon="lock"
      description={t("Protect your account with a 6-digit code from an authenticator app at every sign-in.", "احمِ حسابك برمز من تطبيق المصادقة عند كل تسجيل دخول.")}
      action={enrolled === true ? <Chip tone="ok"><Icon name="check" size="sm" />{t("Enabled", "مفعّل")}</Chip> : enrolled === false ? <Chip>{t("Off", "متوقف")}</Chip> : null}>
      {enrolled === false && !setup && <Row label={t("Authenticator app", "تطبيق المصادقة")} description={t("Google Authenticator, 1Password, or any TOTP app.", "Google Authenticator أو 1Password أو أي تطبيق TOTP.")}><Button variant="primary" icon="lock" busy={busy} onClick={begin}>{t("Enable 2FA", "تفعيل")}</Button></Row>}
      {enrolled === true && !setup && <Row label={t("Authenticator app", "تطبيق المصادقة")} description={t("Codes are required at sign-in. Recovery codes work if you lose the device.", "الرموز مطلوبة عند الدخول. رموز الاسترداد تعمل إذا فقدت الجهاز.")}><Button icon="x" busy={busy} onClick={disable}>{t("Disable", "إيقاف")}</Button></Row>}
      {setup && (
        <form onSubmit={activate} className="mid-form">
          <div className="mid-row" style={{ alignItems: "flex-start", gap: "var(--mid-space-5)" }}>
            <img src={setup.qr} alt="TOTP QR code" className="mid-qr" />
            <div className="mid-stack mid-grow">
              <p className="mid-help">{t("1. Scan the QR with your authenticator app, or enter the secret manually:", "١. امسح الرمز بتطبيق المصادقة أو أدخل السر يدويًا:")}</p>
              <code className="mid-code">{setup.secret}</code>
              <p className="mid-help">{t("2. Enter the current code to activate:", "٢. أدخل الرمز الحالي للتفعيل:")}</p>
              <div className="mid-inline-controls">
                <Input style={{ width: 140 }} inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required />
                <Button variant="primary" type="submit" busy={busy} icon="check">{t("Activate", "تفعيل")}</Button>
                <Button variant="ghost" type="button" onClick={() => setSetup(null)}>{t("Cancel", "إلغاء")}</Button>
              </div>
            </div>
          </div>
        </form>
      )}
      <Modal open={!!recovery} onClose={() => setRecovery(null)} title={t("Save your recovery codes", "احفظ رموز الاسترداد")}
        footer={<><Button icon="copy" onClick={() => navigator.clipboard.writeText((recovery ?? []).join("\n")).catch(() => {})}>{t("Copy all", "نسخ الكل")}</Button><span className="mid-frame-spacer" /><Button variant="primary" onClick={() => setRecovery(null)}>{t("I saved them", "حفظتها")}</Button></>}>
        <p>{t("Each code signs you in once if you lose your authenticator. Store them somewhere safe — they won't be shown again.", "كل رمز يُستخدم مرة واحدة إذا فقدت تطبيق المصادقة. احفظها بمكان آمن — لن تظهر مجددًا.")}</p>
        <code className="mid-code">{(recovery ?? []).join("\n")}</code>
      </Modal>
    </Group>
  );
}

function TokensGroup() {
  const { t } = useLang();
  const { toast } = useToast();
  const [list, setList] = useState<PatMeta[]>([]);
  const [name, setName] = useState("");
  const [minted, setMinted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => tokens.list().then(setList).catch(() => setList([]));
  useEffect(() => { refresh(); }, []);
  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!name.trim()) return; setBusy(true);
    try { const res = await tokens.create(name.trim()); setMinted(res.token); setName(""); refresh(); }
    catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  }
  const mcpConfig = (token: string) => JSON.stringify({ mcpServers: { "mark-it-down": { type: "http", url: `${window.location.origin}/mcp`, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);

  return (
    <Group title={t("Access tokens & MCP", "رموز الوصول وMCP")} icon="code"
      description={t("Bearer tokens for the MCP connector, the Chrome extension, and scripts. A token is shown only once.", "رموز للاتصال عبر MCP وإضافة كروم والسكربتات. يظهر الرمز مرة واحدة فقط.")}>
      <form onSubmit={create} className="mid-inline-controls">
        <Input style={{ width: 260 }} placeholder={t("Token name (e.g. claude-desktop)", "اسم الرمز")} value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="primary" type="submit" icon="plus" busy={busy} disabled={!name.trim()}>{t("Create token", "إنشاء رمز")}</Button>
      </form>
      {list.length > 0 && (
        <ul className="mid-list">
          {list.map((tk) => (
            <li key={tk.id}><Icon name="lock" size="sm" className="mid-icon--muted" /><span className="mid-grow">{tk.name}</span>{tk.created_at && <span className="mid-mono mid-subtle">{new Date(tk.created_at).toLocaleDateString()}</span>}
              <Button variant="ghost" iconOnly icon="trash" title={t("Revoke", "إلغاء")} onClick={async () => { await tokens.revoke(tk.id).catch((e: any) => toast(e.message, "error")); refresh(); }} /></li>
          ))}
        </ul>
      )}
      <Modal open={!!minted} onClose={() => setMinted(null)} title={t("Token created", "تم إنشاء الرمز")}
        footer={<><Button icon="copy" onClick={() => { navigator.clipboard.writeText(mcpConfig(minted!)).catch(() => {}); toast(t("MCP config copied", "نُسخ إعداد MCP")); }}>{t("Copy MCP config", "نسخ إعداد MCP")}</Button><span className="mid-frame-spacer" /><Button variant="primary" onClick={() => setMinted(null)}>{t("Done", "تم")}</Button></>}>
        <p>{t("Copy it now — it won't be shown again.", "انسخه الآن — لن يظهر مجددًا.")}</p>
        <div className="mid-inline-controls"><code className="mid-code mid-grow">{minted}</code><Button iconOnly icon="copy" title={t("Copy token", "نسخ")} onClick={() => { navigator.clipboard.writeText(minted!).catch(() => {}); toast(t("Token copied", "نُسخ")); }} /></div>
        <p style={{ marginTop: "var(--mid-space-3)" }}>{t("Claude Desktop / Claude Code / Cursor config:", "إعداد Claude Desktop / Claude Code / Cursor:")}</p>
        <code className="mid-code">{minted ? mcpConfig(minted) : ""}</code>
      </Modal>
    </Group>
  );
}
