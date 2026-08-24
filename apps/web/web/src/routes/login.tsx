import { useState, useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Terminal, KeyRound } from "lucide-react";
import { AuthCard, AuthErrorAlert, Input, Label, Button, type AuthCardBrand } from "@togo-framework/ui";
import { auth, mfa, clearSession } from "../lib/auth";
import { API, APP_NAME } from "../lib/api";
import { MarkItDownMark } from "../lib/brand";

const BRAND: AuthCardBrand = {
  name: APP_NAME,
  icon: <MarkItDownMark size={40} className="rounded-xl" />,
  tagline: { en: "Your markdown, everywhere", ar: "ماركداونك في كل مكان" },
};

function Methods() {
  const [methods, setMethods] = useState<{ name: string; label: string; type: string; url: string }[]>([]);
  useEffect(() => { auth.methods().then(setMethods); }, []);
  if (!methods.length) return null;
  return (
    <div className="mt-4 space-y-2">
      <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
      {methods.map((m) => (
        <Button key={m.name} variant="outline" className="w-full" onClick={async () => {
          if (m.type === "dev") { await fetch(`${API}${m.url}`, { method: "POST", credentials: "include" }); window.location.href = "/dashboard"; }
          else window.location.href = `${API}${m.url}`;
        }}>{m.type === "dev" ? <Terminal className="h-4 w-4" /> : null}{m.label}</Button>
      ))}
    </div>
  );
}

export function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  // 2FA step: set when the server answers the credential check with a challenge.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  const done = () => { clearSession(); nav({ to: "/dashboard" }); };

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const res = await mfa.login(email, password);
      if (res.mfa_required && res.challenge) { setChallenge(res.challenge); setCode(""); }
      else done();
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
      <AuthCard brand={BRAND} language="en" layout="split">
        <div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /><h1 className="text-2xl font-semibold">Two-factor check</h1></div>
        <p className="mt-1 text-sm text-muted-foreground">
          {useRecovery ? "Enter one of your recovery codes." : "Enter the 6-digit code from your authenticator app."}
        </p>
        <form onSubmit={submitCode} className="mt-6 space-y-4">
          <AuthErrorAlert error={err} />
          <div className="space-y-1.5">
            <Label htmlFor="code">{useRecovery ? "Recovery code" : "Authentication code"}</Label>
            <Input id="code" inputMode={useRecovery ? "text" : "numeric"} autoFocus autoComplete="one-time-code"
              placeholder={useRecovery ? "xxxx-xxxx" : "123456"} value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Verifying…" : "Verify"}</Button>
        </form>
        <div className="mt-4 flex items-center justify-between text-sm">
          <button type="button" className="text-muted-foreground hover:text-foreground hover:underline" onClick={() => { setChallenge(null); setErr(""); }}>
            ← Back to login
          </button>
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => { setUseRecovery((v) => !v); setCode(""); setErr(""); }}>
            {useRecovery ? "Use authenticator code" : "Use a recovery code"}
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard brand={BRAND} language="en" layout="split">
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">Sign in to your account</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <AuthErrorAlert error={err} />
        <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/reset" className="text-xs font-medium text-primary hover:underline">Forgot password?</Link>
          </div>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
      <Methods />
      <p className="mt-6 text-center text-sm text-muted-foreground">No account? <Link to="/register" className="font-medium text-primary hover:underline">Create one</Link></p>
    </AuthCard>
  );
}
