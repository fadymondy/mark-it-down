// Admin home (/admin): users, resources and mail settings. Same design system as
// the desktop app (mid-* classes only); data from src/lib/admin.ts.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Alert, Button, Chip, Field, Group, Icon, Input, Modal, fmtDate, useToast } from "../components/ui";
import { useLang } from "../lib/i18n";
import { AdminApiError, adminList, adminMail, adminUsers, metaResources, type AdminUser, type MailSettings, type ResourceMeta } from "../lib/admin";

type T = (en: string, ar: string) => string;
type Status = { tone: "info" | "danger"; msg: string };

const labelOf = (name: string) => name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const when = (iso: string) => (iso && !isNaN(Date.parse(iso)) ? fmtDate(iso) : iso || "—");

/** Turn an admin API failure into a friendly, tone-tagged message (401/403 → not an admin). */
function describe(e: unknown, t: T): Status {
  const status = e instanceof AdminApiError ? e.status : 0;
  if (status === 401 || status === 403) return { tone: "info", msg: t("You need an admin account to manage users and mail settings.", "تحتاج إلى حساب مسؤول لإدارة المستخدمين وإعدادات البريد.") };
  if (status === 404) return { tone: "info", msg: t("The admin API is not available — install the auth plugin (togo install togo-framework/auth).", "واجهة الإدارة غير متاحة — ثبّت إضافة المصادقة (togo install togo-framework/auth).") };
  return { tone: "danger", msg: e instanceof Error ? e.message : String(e) };
}

export function AdminHome() {
  const { t, dir } = useLang();
  return (
    <div className="mid-page mid-page--wide" dir={dir}>
      <div className="mid-page-head">
        <div>
          <h1 className="mid-page-title">{t("Admin", "الإدارة")}</h1>
          <p className="mid-page-subtitle">{t("Users, resources and mail settings.", "المستخدمون والموارد وإعدادات البريد.")}</p>
        </div>
      </div>
      <div className="mid-settings-form">
        <UsersGroup />
        <ResourcesGroup />
        <MailGroup />
      </div>
    </div>
  );
}

// ---- Users ----

type UserAction =
  | { kind: "add" }
  | { kind: "reset"; user: AdminUser }
  | { kind: "delete"; user: AdminUser }
  | { kind: "link"; user: AdminUser; link: string };

function UsersGroup() {
  const { t } = useLang();
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [action, setAction] = useState<UserAction | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const list = await adminUsers.list(); setUsers(Array.isArray(list) ? list : []); setStatus(null); }
    catch (e) { setUsers([]); setStatus(describe(e, t)); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try { await fn(); } catch (e: any) { toast(e?.message || String(e), "error"); } finally { setBusy(null); }
  }
  const impersonate = (u: AdminUser) => run(u.id, async () => {
    await adminUsers.impersonate(u.id);
    toast(t(`Signed in as ${u.email}`, `تم تسجيل الدخول باسم ${u.email}`));
    window.location.assign("/dashboard"); // session cookie changed server-side → reload the app as that user
  });
  const magicLink = (u: AdminUser) => run(u.id, async () => {
    const r = await adminUsers.magicLink(u.id);
    if (r.emailed) toast(t(`Sign-in link emailed to ${u.email}`, `تم إرسال رابط الدخول إلى ${u.email}`));
    else setAction({ kind: "link", user: u, link: r.link });
  });
  const close = useCallback(() => setAction(null), []);
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast(t("Copied", "تم النسخ"))).catch(() => toast(t("Copy failed", "فشل النسخ"), "error"));

  const empty = status !== null || users === null || users.length === 0;
  return (
    <>
      <Group title={t("Users", "المستخدمون")} icon="lock" description={t("Accounts from the auth plugin. Impersonate, send sign-in links, reset passwords.", "الحسابات من إضافة المصادقة: انتحال، روابط دخول، إعادة تعيين كلمات المرور.")}
        flush={!empty}
        action={<Button variant="primary" icon="plus" disabled={status?.tone === "info"} onClick={() => setAction({ kind: "add" })}>{t("Add user", "إضافة مستخدم")}</Button>}>
        {status ? <Alert tone={status.tone}>{status.msg}</Alert>
          : users === null ? <p className="mid-settings-empty">{t("Loading…", "جارٍ التحميل…")}</p>
          : users.length === 0 ? <p className="mid-settings-empty">{t("No users yet.", "لا يوجد مستخدمون بعد.")}</p>
          : (
            <>
              <div className="mid-table-wrap">
                <table className="mid-table">
                  <thead>
                    <tr><th>{t("Email", "البريد الإلكتروني")}</th><th>{t("Roles", "الأدوار")}</th><th>{t("Created", "تاريخ الإنشاء")}</th><th /></tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.email}<div className="mid-mono mid-muted">{u.id}</div></td>
                        <td>
                          <span className="mid-row mid-row--wrap">
                            {u.roles.length ? u.roles.map((r) => <Chip key={r} tone={r === "admin" ? "accent" : undefined}>{r}</Chip>) : <span className="mid-subtle">—</span>}
                          </span>
                        </td>
                        <td className="is-mono">{when(u.created_at)}</td>
                        <td>
                          <div className="mid-row-actions">
                            <Button variant="ghost" iconOnly icon="show" busy={busy === u.id} aria-label={t("Impersonate", "انتحال")} title={t("Impersonate", "انتحال")} onClick={() => impersonate(u)} />
                            <Button variant="ghost" iconOnly icon="link" disabled={busy === u.id} aria-label={t("Send magic link", "إرسال رابط دخول")} title={t("Send magic link", "إرسال رابط دخول")} onClick={() => magicLink(u)} />
                            <Button variant="ghost" iconOnly icon="lock" disabled={busy === u.id} aria-label={t("Reset password", "إعادة تعيين كلمة المرور")} title={t("Reset password", "إعادة تعيين كلمة المرور")} onClick={() => setAction({ kind: "reset", user: u })} />
                            <Button variant="ghost" iconOnly icon="trash" disabled={busy === u.id} aria-label={t("Delete", "حذف")} title={t("Delete", "حذف")} onClick={() => setAction({ kind: "delete", user: u })} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mid-table-footer">
                <span>{users.length} {t("users", "مستخدم")}</span>
                <Button variant="ghost" icon="refresh" onClick={load}>{t("Refresh", "تحديث")}</Button>
              </div>
            </>
          )}
      </Group>

      <AddUserModal open={action?.kind === "add"} onClose={close} onDone={(note) => { close(); toast(t("User created", "تم إنشاء المستخدم")); if (note) toast(note); load(); }} />
      <ResetPasswordModal user={action?.kind === "reset" ? action.user : null} onClose={close}
        onDone={(link) => { const u = action?.kind === "reset" ? action.user : null; close(); if (link && u) setAction({ kind: "link", user: u, link }); else toast(t("Password updated", "تم تحديث كلمة المرور")); }} />
      <DeleteUserModal user={action?.kind === "delete" ? action.user : null} onClose={close} onDone={() => { close(); toast(t("User deleted", "تم حذف المستخدم")); load(); }} />

      <Modal open={action?.kind === "link"} onClose={close} title={t("Sign-in link", "رابط الدخول")}
        footer={<>
          <Button variant="secondary" onClick={close}>{t("Close", "إغلاق")}</Button>
          <Button variant="primary" icon="copy" onClick={() => action?.kind === "link" && copy(action.link)}>{t("Copy link", "نسخ الرابط")}</Button>
        </>}>
        {action?.kind === "link" ? (
          <div className="mid-stack">
            <Alert tone="info">{t(`SMTP is not configured, so the link was not emailed. Share it with ${action.user.email} — it expires in one hour.`, `لم يُضبط SMTP، لذلك لم يُرسل الرابط بالبريد. شاركه مع ${action.user.email} — تنتهي صلاحيته خلال ساعة.`)}</Alert>
            <pre className="mid-code">{action.link}</pre>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function AddUserModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (note: string) => void }) {
  const { t } = useLang();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setEmail(""); setPassword(""); setRoles(""); setErr(""); } }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr("");
    if (!email.trim()) { setErr(t("Email is required", "البريد الإلكتروني مطلوب")); return; }
    setBusy(true);
    try {
      const r = await adminUsers.create({ email: email.trim(), password: password || undefined, roles: roles.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean) });
      onDone(r.note || "");
    } catch (ex: any) { setErr(ex?.message || String(ex)); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("Add user", "إضافة مستخدم")}>
      <form className="mid-form" onSubmit={submit} noValidate>
        <Alert tone="danger">{err}</Alert>
        <Field label={t("Email", "البريد الإلكتروني")}>
          <Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t("Password", "كلمة المرور")} help={t("Leave empty to send a sign-in link instead.", "اتركها فارغة لإرسال رابط دخول بدلاً من ذلك.")}>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={t("Roles", "الأدوار")} help={t("Comma-separated, e.g. admin, editor", "مفصولة بفواصل، مثل admin, editor")}>
          <Input value={roles} placeholder="admin" onChange={(e) => setRoles(e.target.value)} />
        </Field>
        <div className="mid-row">
          <span className="mid-grow" />
          <Button type="button" variant="secondary" onClick={onClose}>{t("Cancel", "إلغاء")}</Button>
          <Button type="submit" variant="primary" icon="plus" busy={busy}>{t("Create", "إنشاء")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: AdminUser | null; onClose: () => void; onDone: (link?: string) => void }) {
  const { t } = useLang();
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (user) { setPassword(""); setErr(""); } }, [user]);

  async function submit(e: FormEvent) {
    e.preventDefault(); if (!user) return;
    setErr(""); setBusy(true);
    try { const r = await adminUsers.resetPassword(user.id, password); onDone(r.reset || r.emailed ? undefined : r.link); }
    catch (ex: any) { setErr(ex?.message || String(ex)); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={!!user} onClose={onClose} title={t("Reset password", "إعادة تعيين كلمة المرور")}>
      <form className="mid-form" onSubmit={submit} noValidate>
        <Alert tone="danger">{err}</Alert>
        <p className="mid-settings-empty">{user?.email}</p>
        <Field label={t("New password", "كلمة المرور الجديدة")} help={t("Leave empty to email the user a link to set their own.", "اتركها فارغة لإرسال رابط للمستخدم ليعيّن كلمة المرور بنفسه.")}>
          <Input type="password" autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="mid-row">
          <span className="mid-grow" />
          <Button type="button" variant="secondary" onClick={onClose}>{t("Cancel", "إلغاء")}</Button>
          <Button type="submit" variant="primary" icon="lock" busy={busy}>{password ? t("Set password", "تعيين كلمة المرور") : t("Send link", "إرسال الرابط")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteUserModal({ user, onClose, onDone }: { user: AdminUser | null; onClose: () => void; onDone: () => void }) {
  const { t } = useLang();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function del() {
    if (!user) return;
    setBusy(true);
    try { await adminUsers.remove(user.id); onDone(); }
    catch (e: any) { toast(e?.message || String(e), "error"); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={!!user} onClose={onClose} title={t("Delete user", "حذف المستخدم")}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t("Cancel", "إلغاء")}</Button>
        <Button variant="destructive" icon="trash" busy={busy} onClick={del}>{t("Delete", "حذف")}</Button>
      </>}>
      <Alert tone="danger">{t("This action cannot be undone.", "لا يمكن التراجع عن هذا الإجراء.")}</Alert>
      <p className="mid-settings-empty">{t("Delete", "حذف")} <strong>{user?.email}</strong>?</p>
    </Modal>
  );
}

// ---- Resources ----

function ResourcesGroup() {
  const { t } = useLang();
  const [list, setList] = useState<ResourceMeta[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    metaResources().then(async (rs) => {
      if (!alive) return;
      setList(rs);
      const pairs = await Promise.all(rs.map(async (r) => [r.table, (await adminList(r.table).catch(() => [])).length] as const));
      if (alive) setCounts(Object.fromEntries(pairs));
    }).catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, []);

  return (
    <Group title={t("Resources", "الموارد")} icon="columns" description={t("Generated resources (togo.resources.yaml), exposed over REST and GraphQL.", "الموارد المولّدة (togo.resources.yaml) عبر REST وGraphQL.")}>
      {list === null ? <p className="mid-settings-empty">{t("Loading…", "جارٍ التحميل…")}</p>
        : list.length === 0 ? (
          <p className="mid-settings-empty">{t("No resources yet — run", "لا توجد موارد بعد — شغّل")} <code className="mid-inline">togo make:resource Post title:string</code> {t("and they will appear here.", "وستظهر هنا.")}</p>
        ) : (
          <ul className="mid-list">
            {list.map((r) => (
              <li key={r.table}>
                <Icon name="folder" className="mid-icon--muted" />
                <Link to="/admin/$resource" params={{ resource: r.table }}>{labelOf(r.name || r.table)}</Link>
                {r.group ? <Chip>{r.group}</Chip> : null}
                <span className="mid-mono mid-muted">/api/{r.table}</span>
                <span className="mid-list-row-count">{counts[r.table] ?? "…"}</span>
              </li>
            ))}
          </ul>
        )}
    </Group>
  );
}

// ---- Mail ----

const EMPTY_MAIL: MailSettings = { host: "", port: 587, username: "", password: "", from: "", secure: false };

function MailGroup() {
  const { t } = useLang();
  const { toast } = useToast();
  const [cfg, setCfg] = useState<MailSettings>(EMPTY_MAIL);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);

  useEffect(() => {
    let alive = true;
    adminMail.get()
      .then((c) => { if (alive) { setCfg({ ...EMPTY_MAIL, ...(c && typeof c === "object" ? c : {}) }); setStatus(null); } })
      .catch((e) => { if (alive) setStatus(describe(e, t)); });
    return () => { alive = false; };
  }, [t]);

  const set = <K extends keyof MailSettings>(k: K, v: MailSettings[K]) => setCfg((c) => ({ ...c, [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy("save");
    try { await adminMail.put({ ...cfg, port: Number(cfg.port) || 0 }); toast(t("Mail settings saved", "تم حفظ إعدادات البريد")); }
    catch (ex: any) { toast(ex?.message || String(ex), "error"); }
    finally { setBusy(null); }
  }
  async function test() {
    setBusy("test");
    try { const r = await adminMail.test(); if (r.ok) toast(t("Test email sent", "تم إرسال بريد تجريبي")); else toast(r.error || t("Test failed", "فشل الاختبار"), "error"); }
    catch (ex: any) { toast(ex?.message || String(ex), "error"); }
    finally { setBusy(null); }
  }

  return (
    <Group title={t("Mail", "البريد")} icon="cog" description={t("SMTP used for sign-in links and password resets.", "خادم SMTP المستخدم لروابط الدخول وإعادة تعيين كلمات المرور.")}>
      {status ? <Alert tone={status.tone}>{status.msg}</Alert> : (
        <form className="mid-form" onSubmit={save} noValidate>
          <div className="mid-row">
            <div className="mid-grow">
              <Field label={t("Host", "المضيف")}><Input value={cfg.host} placeholder="smtp.example.com" onChange={(e) => set("host", e.target.value)} /></Field>
            </div>
            <div>
              <Field label={t("Port", "المنفذ")}><Input type="number" min={1} max={65535} value={cfg.port || ""} placeholder="587" onChange={(e) => set("port", Number(e.target.value) || 0)} /></Field>
            </div>
          </div>
          <div className="mid-row">
            <div className="mid-grow">
              <Field label={t("Username", "اسم المستخدم")}><Input autoComplete="off" value={cfg.username} onChange={(e) => set("username", e.target.value)} /></Field>
            </div>
            <div className="mid-grow">
              <Field label={t("Password", "كلمة المرور")} help={t("Leave the mask unchanged to keep the saved password.", "اترك القناع كما هو للاحتفاظ بكلمة المرور المحفوظة.")}>
                <Input type="password" autoComplete="new-password" value={cfg.password} onChange={(e) => set("password", e.target.value)} />
              </Field>
            </div>
          </div>
          <Field label={t("From address", "عنوان المرسل")}><Input type="email" value={cfg.from} placeholder="noreply@example.com" onChange={(e) => set("from", e.target.value)} /></Field>
          <label className="mid-row">
            <input type="checkbox" checked={cfg.secure} onChange={(e) => set("secure", e.target.checked)} />
            <span className="mid-label">{t("Implicit TLS (port 465)", "TLS ضمني (المنفذ 465)")}</span>
          </label>
          <div className="mid-row">
            <Button type="submit" variant="primary" icon="save" busy={busy === "save"}>{t("Save", "حفظ")}</Button>
            <Button type="button" variant="secondary" busy={busy === "test"} disabled={!cfg.host} onClick={test}>{t("Send test email", "إرسال بريد تجريبي")}</Button>
          </div>
        </form>
      )}
    </Group>
  );
}
