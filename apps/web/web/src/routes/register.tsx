import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { auth, clearSession } from "../lib/auth";
import { Alert, Button, Field, Input } from "../components/ui";
import { useLang } from "../lib/i18n";
import { AuthShell } from "./login";

export function Register() {
  const nav = useNavigate();
  const { t } = useLang();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await auth.register(email, password); clearSession(); nav({ to: "/notes" }); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <AuthShell title={t("Create your account", "أنشئ حسابك")} subtitle={t("Your notes, everywhere — in seconds.", "ملاحظاتك في كل مكان — خلال ثوانٍ.")}
      footer={<>
        <span className="mid-muted" style={{ fontSize: "var(--mid-font-size-sm)" }}>{t("Already registered?", "لديك حساب؟")} <Link to="/login">{t("Sign in", "دخول")}</Link></span>
        <span className="mid-frame-spacer" />
        <Button variant="primary" type="submit" form="register-form" busy={busy} icon="check">{t("Create account", "إنشاء حساب")}</Button>
      </>}>
      <form id="register-form" onSubmit={submit} className="mid-form">
        <Alert tone="danger">{err}</Alert>
        <Field label={t("Email", "البريد الإلكتروني")}>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label={t("Password", "كلمة المرور")} help={t("At least 8 characters.", "8 أحرف على الأقل.")}>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </Field>
      </form>
    </AuthShell>
  );
}
