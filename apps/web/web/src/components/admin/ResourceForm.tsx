// ResourceForm — schema-driven create/edit form for any admin resource.
// Every field renders the control its type implies (text/textarea/number/checkbox/
// date/datetime/email/enum select/relation select/json), validates, and submits
// through adminCreate/adminUpdate. Same design system as the desktop app.
import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Chip, Field, Input, Select, Textarea } from "../ui";
import { useLang } from "../../lib/i18n";
import {
  adminCreate, adminList, adminUpdate, controlFor, relationTable, rowLabel, validateField,
  type Control, type ResourceField,
} from "../../lib/admin";

const labelOf = (name: string) => name.replace(/_id$/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

type FormState = Record<string, string>;
type Errors = Record<string, string>;

function initial(fields: ResourceField[], row?: Record<string, any>): FormState {
  const init: FormState = {};
  for (const f of fields) {
    const v = row ? row[f.name] : undefined;
    init[f.name] = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);
  }
  return init;
}

function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }

/** Convert the string form state into the typed payload the API expects. */
export function toPayload(fields: ResourceField[], value: FormState): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of fields) {
    const v = value[f.name] ?? "";
    const c = controlFor(f);
    if (v === "") { if (!f.nullable && c !== "switch") payload[f.name] = ""; continue; }
    payload[f.name] = c === "number" || c === "relation" ? Number(v) : c === "switch" ? v === "true" : c === "json" ? safeJson(v) : v;
  }
  return payload;
}

/** Validate the whole form against the schema; returns {errors, ok}. */
export function validateForm(fields: ResourceField[], value: FormState): { errors: Errors; ok: boolean } {
  const errors: Errors = {};
  for (const f of fields) {
    const e = validateField(f, value[f.name] ?? "");
    if (e) errors[f.name] = e;
  }
  return { errors, ok: Object.keys(errors).length === 0 };
}

export function ResourceForm({ table, fields, row, onSaved, onCancel }: {
  table: string;
  fields: ResourceField[];
  /** Existing row → edit (PUT); omitted → create (POST). */
  row?: Record<string, any>;
  onSaved: (mode: "create" | "edit") => void;
  onCancel?: () => void;
}) {
  const { t } = useLang();
  const [value, setValue] = useState<FormState>(() => initial(fields, row));
  const [errors, setErrors] = useState<Errors>({});
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setValue(initial(fields, row)); setErrors({}); setErr(""); }, [fields, row]);

  const set = (name: string, v: string) => setValue((s) => ({ ...s, [name]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    const { errors: errs, ok } = validateForm(fields, value);
    setErrors(errs);
    if (!ok) return;
    setSaving(true);
    try {
      const payload = toPayload(fields, value);
      if (row && row.id !== undefined && row.id !== null) { await adminUpdate(table, String(row.id), payload); onSaved("edit"); }
      else { await adminCreate(table, payload); onSaved("create"); }
    } catch (ex: any) { setErr(ex?.message || String(ex)); }
    finally { setSaving(false); }
  }

  return (
    <form className="mid-form" onSubmit={submit} noValidate>
      <Alert tone="danger">{err}</Alert>
      {fields.length === 0 ? <p className="mid-settings-empty">{t("This resource has no editable fields.", "لا توجد حقول قابلة للتعديل في هذا المورد.")}</p> : null}
      {fields.map((f) => (
        <FormField key={f.name} f={f} value={value[f.name] ?? ""} error={errors[f.name]} onChange={(v) => set(f.name, v)} />
      ))}
      <div className="mid-row">
        <span className="mid-grow" />
        {onCancel ? <Button type="button" variant="secondary" onClick={onCancel}>{t("Cancel", "إلغاء")}</Button> : null}
        <Button type="submit" variant="primary" icon="save" busy={saving}>{saving ? t("Saving…", "جارٍ الحفظ…") : t("Save", "حفظ")}</Button>
      </div>
    </form>
  );
}

const INPUT_TYPE: Partial<Record<Control, string>> = { number: "number", datetime: "datetime-local", date: "date", email: "email" };

function FormField({ f, value, error, onChange }: { f: ResourceField; value: string; error?: string; onChange: (v: string) => void }) {
  const { t } = useLang();
  const control = controlFor(f);
  const required = !f.nullable && control !== "switch";
  const label = labelOf(f.name) + (required ? " *" : "");
  const errText = error
    ? ({ required: t("This field is required", "هذا الحقل مطلوب"), email: t("Invalid email", "بريد إلكتروني غير صالح"), number: t("Invalid number", "رقم غير صالح") } as Record<string, string>)[error] ?? error
    : "";
  const trailing = errText ? <Chip tone="warn">{errText}</Chip> : undefined;

  if (control === "switch") {
    return (
      <label className="mid-row">
        <input type="checkbox" name={f.name} checked={value === "true"} onChange={(e) => onChange(e.target.checked ? "true" : "false")} />
        <span className="mid-label">{labelOf(f.name)}</span>
      </label>
    );
  }

  if (control === "select" && f.enum?.length) {
    return (
      <Field label={label} trailing={trailing}>
        <Select name={f.name} value={value} aria-invalid={!!error} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t("Select…", "اختر…")}</option>
          {f.enum.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      </Field>
    );
  }

  if (control === "relation") {
    return (
      <Field label={label} trailing={trailing}>
        <RelationPicker f={f} value={value} onChange={onChange} invalid={!!error} />
      </Field>
    );
  }

  if (control === "textarea" || control === "json") {
    return (
      <Field label={label} trailing={trailing} help={control === "json" ? t("JSON value", "قيمة JSON") : undefined}>
        <Textarea name={f.name} rows={control === "json" ? 5 : 4} value={value} aria-invalid={!!error}
          className={control === "json" ? "mid-mono" : ""} placeholder={control === "json" ? "{ }" : undefined}
          onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  }

  return (
    <Field label={label} trailing={trailing}>
      <Input name={f.name} type={INPUT_TYPE[control] ?? "text"} value={value} aria-invalid={!!error} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Belongs-to relation picker — fetches the related resource and lists its rows. */
function RelationPicker({ f, value, onChange, invalid }: { f: ResourceField; value: string; onChange: (v: string) => void; invalid: boolean }) {
  const { t } = useLang();
  const table = relationTable(f)!;
  const [opts, setOpts] = useState<{ id: string; label: string }[] | null>(null);
  useEffect(() => {
    let alive = true;
    adminList(table)
      .then((rows) => { if (alive) setOpts(rows.map((r) => ({ id: String(r.id), label: rowLabel(r) }))); })
      .catch(() => { if (alive) setOpts([]); });
    return () => { alive = false; };
  }, [table]);
  return (
    <Select name={f.name} value={value} aria-invalid={invalid} onChange={(e) => onChange(e.target.value)}>
      <option value="">{opts === null ? t("Loading…", "جارٍ التحميل…") : opts.length === 0 ? t("No records", "لا توجد سجلات") : t(`Select ${table}`, `اختر ${table}`)}</option>
      {(opts ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </Select>
  );
}
