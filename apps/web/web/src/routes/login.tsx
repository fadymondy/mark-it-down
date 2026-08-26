import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { auth, mfa, clearSession } from "../lib/auth";
import { API, APP_NAME } from "../lib/api";
import { MarkItDownMark } from "../lib/brand";
import { Alert, Button, Field, Frame, Icon, Input } from "../components/ui";
import { useLang } from "../lib/i18n";
import { useTheme } from "../lib/theme";

/** Shared chrome for the auth pages: desktop "onboarding frame" centered on the app background. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const { t, lang, setLang, dir } = useLang();
  const { isDark, setMode } = useTheme();
  return (
    <div className="mid-auth" dir={dir}>
      <div className="mid-auth-top">
        <Button variant="ghost" onClick={() => setLang(lang === "ar" ? "en" : "ar")} title={t("Language", "اللغة")}>{lang === "ar" ? "EN" : "AR"}</Button>
        <Button variant="ghost" iconOnly icon="show" title={t("Toggle light/dark", "تبديل الوضع")} onClick={() => setMode(isDark ? "light" : "dark")} />
      </div>
      <Frame footer={footer}>
        <div className="mid-auth-intro">
          <Link to="/" className="mid-auth-glyph" title={APP_NAME}><MarkItDownMark size={56} /></Link>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {children}
      </Frame>
    </div>
  );
}

function Methods() {
  const { t } = useLang();
  const [methods, setMethods] = useState<{ name: string; label: string; type: string; url: string }[]>([]);
  useEffect(() => { auth.methods().then(setMethods); }, []);
  if (!methods.length) return null;
  return (
    <div className="mid-stack" style={{ marginTop: "var(--mid-space-4)" }}>
      <hr className="mid-divider" />
      {methods.map((m) => (
        <Button key={m.name} icon={m.type === "dev" ? "code" : "link"} onClick={async () => {
          if (m.type === "dev") {
            const r = await fetch(`${API}${m.url}`, { method: "POST", credentials: "include" });
            if (r.ok) { clearSession(); window.location.href = "/notes"; }
          } else window.location.href = `${API}${m.url}`;
        }}>{m.type === "dev" ? t("Login as developer", "دخول كمطوّر") : m.label}</Button>
      ))}
    </div>
  );
}

export function Login() {
  const nav = useNavigate();
  const { t } = useLang();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const done = () => { clearSession(); nav({ to: "/notes" }); };

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const res = await mfa.login(email, password);
      if (res.mfa_required && res.challenge) { setChallenge(res.challenge); setCode(""); } else done();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function submitCode(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      if (useRecovery) await mfa.recoveryVerify(challenge!, code.trim());
      else await mfa.totpVerify({ challenge: challenge!, code: code.trim() });
      done();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  if (challenge) {
    return (
      <AuthShell title={t("Two-factor check", "التحقق بخطوتين")} subtitle={useRecovery ? t("Enter one of your recovery codes.", "أدخل أحد رموز الاسترداد.") : t("Enter the 6-digit code from your authenticator app.", "أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة.")}
        footer={<>
          <Button variant="ghost" onClick={() => { setChallenge(null); setErr(""); }}>{t("Back", "رجوع")}</Button>
          <span className="mid-frame-spacer" />
          <Button variant="ghost" onClick={() => { setUseRecovery((v) => !v); setCode(""); setErr(""); }}>{useRecovery ? t("Use authenticator code", "استخدم رمز المصادقة") : t("Use a recovery code", "استخدم رمز استرداد")}</Button>
          <Button variant="primary" type="submit" form="mfa-form" busy={busy} icon="lock">{t("Verify", "تحقق")}</Button>
        </>}>
        <form id="mfa-form" onSubmit={submitCode} className="mid-form">
          <Alert tone="danger">{err}</Alert>
          <Field label={useRecovery ? t("Recovery code", "رمز الاسترداد") : t("Authentication code", "رمز المصادقة")}>
            <Input inputMode={useRecovery ? "text" : "numeric"} autoFocus autoComplete="one-time-code" placeholder={useRecovery ? "xxxx-xxxx" : "123456"} value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("Welcome back", "مرحبًا بعودتك")} subtitle={t("Sign in to your warehouse", "سجّل الدخول إلى مستودعك")}
      footer={<>
        <span className="mid-muted" style={{ fontSize: "var(--mid-font-size-sm)" }}>{t("No account?", "لا تملك حسابًا؟")} <Link to="/register">{t("Create one", "أنشئ حسابًا")}</Link></span>
        <span className="mid-frame-spacer" />
        <Button variant="primary" type="submit" form="login-form" busy={busy} icon="chevron-right">{t("Sign in", "دخول")}</Button>
      </>}>
      <form id="login-form" onSubmit={submit} className="mid-form">
        <Alert tone="danger">{err}</Alert>
        <Field label={t("Email", "البريد الإلكتروني")}>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label={t("Password", "كلمة المرور")} trailing={<Link to="/reset" style={{ fontSize: "var(--mid-font-size-xs)" }}>{t("Forgot password?", "نسيت كلمة المرور؟")}</Link>}>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
      </form>
      <Methods />
      <p className="mid-auth-links"><Icon name="lock" size="sm" /> {t("Protected by session cookies and optional TOTP 2FA.", "محميّ بجلسات وتحقق ثنائي اختياري.")}</p>
    </AuthShell>
  );
}
