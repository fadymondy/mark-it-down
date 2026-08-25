// Infolist — read-only key/value view of one resource row, driven by the schema.
// Same design system as the desktop app (mid-* classes only).
import { Chip, fmtDate } from "../ui";
import { useLang } from "../../lib/i18n";
import { controlFor, formatValue, type ResourceField } from "../../lib/admin";

const labelOf = (name: string) => name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Labelled rows with chips for enums/bools, formatted dates, and a — placeholder for empties.
 * Schema fields first (declared order), then any extra row keys (id/timestamps). */
export function Infolist({ row, fields }: { row: Record<string, any>; fields: ResourceField[] }) {
  const { lang } = useLang();
  const byName = new Map(fields.map((f) => [f.name, f]));
  const keys = [
    "id",
    ...fields.map((f) => f.name).filter((n) => n !== "id"),
    ...Object.keys(row).filter((k) => k !== "id" && !byName.has(k)),
  ].filter((k, i, a) => a.indexOf(k) === i && k in row);

  return (
    <ul className="mid-list">
      {keys.map((k) => (
        <li key={k}>
          <div className="mid-setting-row mid-grow">
            <div className="mid-setting-row__label mid-muted">{labelOf(k)}</div>
            <div className="mid-setting-row__control"><Value f={byName.get(k)} name={k} v={row[k]} lang={lang} /></div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Value({ f, name, v, lang }: { f?: ResourceField; name: string; v: any; lang: string }) {
  if (v === null || v === undefined || v === "") return <span className="mid-subtle">—</span>;
  const control = f ? controlFor(f) : "text";
  if (control === "switch" || typeof v === "boolean") {
    const on = v === true || v === "true";
    return <Chip tone={on ? "ok" : undefined}>{on ? "Yes" : "No"}</Chip>;
  }
  if (control === "select") return <Chip tone="accent">{String(v)}</Chip>;
  if (control === "relation") return <span className="mid-mono">#{String(v)}</span>;
  if (name === "id") return <span className="mid-mono">{String(v)}</span>;
  if (typeof v === "object") return <pre className="mid-code">{JSON.stringify(v, null, 2)}</pre>;
  if (control === "date" || control === "datetime" || /_at$/.test(name)) {
    const d = new Date(v);
    return <span>{isNaN(d.getTime()) ? String(v) : fmtDate(String(v))}</span>;
  }
  return <span>{formatValue(f, v, lang)}</span>;
}
