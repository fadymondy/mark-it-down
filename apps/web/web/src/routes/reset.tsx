import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { auth } from "../lib/auth";
import { Alert, Button, Field, Input } from "../components/ui";
import { useLang } from "../lib/i18n";
import { AuthShell } from "./login";

// Two steps in the desktop "stepper" idiom: request an emailed code, then set a
// new password with it (POST /api/auth/reset-password, code-verified).
export function Reset() {
  const nav = useNavigate();
  const { t } = useLang();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState(""); const [code, setCode] = useState(""); const [password, setPassword] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);

  async function request(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await auth.requestOtp(email, "reset"); setStep(2); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function finish(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await auth.resetPassword(email, code.trim(), password); nav({ to: "/login" }); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  const steps = (
    <ul className="mid-steps" style={{ margin: "calc(-1 * var(--mid-space-5)) calc(-1 * var(--mid-space-5)) var(--mid-space-4)" }}>
      <li className={step === 1 ? "is-active" : "is-done"}>1 · {t("Email", "البريد")}</li>
      <li className={step === 2 ? "is-active" : ""}>2 · {t("New password", "كلمة مرور جديدة")}</li>
    </ul>
  );

  return (
    <AuthShell title={t("Reset password", "إعادة تعيين كلمة المرور")} subtitle={step === 1 ? t("We'll email you a 6-digit reset code.", "سنرسل رمزًا من 6 أرقام إلى بريدك.") : t(`Enter the code sent to ${email} and choose a new password.`, `أدخل الرمز المرسل إلى ${email} واختر كلمة مرور جديدة.`)}
      footer={<>
        <Link to="/login" className="mid-muted" style={{ fontSize: "var(--mid-font-size-sm)" }}>{t("Back to sign in", "العودة لتسجيل الدخول")}</Link>
        <span className="mid-frame-spacer" />
        {step === 2 && <Button variant="ghost" onClick={() => { setStep(1); setErr(""); }}>{t("Back", "رجوع")}</Button>}
        <Button variant="primary" type="submit" form="reset-form" busy={busy} icon={step === 1 ? "chevron-right" : "check"}>{step === 1 ? t("Send code", "إرسال الرمز") : t("Set new password", "حفظ كلمة المرور")}</Button>
      </>}>
      {steps}
      {step === 1 ? (
        <form id="reset-form" onSubmit={request} className="mid-form">
          <Alert tone="danger">{err}</Alert>
          <Field label={t("Email", "البريد الإلكتروني")}><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        </form>
      ) : (
        <form id="reset-form" onSubmit={finish} className="mid-form">
          <Alert tone="danger">{err}</Alert>
          <Alert tone="info">{t("If an account exists for that email, the code is on its way (valid 10 minutes).", "إذا كان الحساب موجودًا فالرمز في طريقه إليك (صالح 10 دقائق).")}</Alert>
          <Field label={t("Reset code", "رمز إعادة التعيين")}><Input inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus /></Field>
          <Field label={t("New password", "كلمة المرور الجديدة")} help={t("At least 8 characters.", "8 أحرف على الأقل.")}><Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></Field>
        </form>
      )}
    </AuthShell>
  );
}
