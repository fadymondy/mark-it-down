// React primitives over the shared Mark It Down design system (packages/ui-tokens).
// Every class here exists in the desktop renderer too — no kit, no Tailwind.
import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { icons, type IconName } from "@mid/tokens/icons";

export type { IconName };

export function Icon({ name, size, className = "" }: { name: IconName; size?: "sm" | "lg" | "xl"; className?: string }) {
  const def = icons[name];
  const cls = `mid-icon${size ? ` mid-icon--${size}` : ""}${className ? ` ${className}` : ""}`;
  return <svg className={cls} viewBox={def.viewBox} aria-hidden="true" dangerouslySetInnerHTML={{ __html: def.body }} />;
}

type Variant = "default" | "primary" | "secondary" | "ghost" | "destructive";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; icon?: IconName; iconOnly?: boolean; busy?: boolean;
}
export function Button({ variant = "default", icon, iconOnly, busy, className = "", children, disabled, ...rest }: ButtonProps) {
  const cls = ["mid-btn", "mid-pressable", variant !== "default" ? `mid-btn--${variant}` : "", iconOnly ? "mid-btn--icon" : "", className].filter(Boolean).join(" ");
  return (
    <button className={cls} disabled={disabled || busy} {...rest}>
      {busy ? <span className="mid-spinner" /> : icon ? <Icon name={icon} /> : null}
      {iconOnly ? null : children}
    </button>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={`mid-settings-control ${className}`} {...rest} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return <textarea className={`mid-settings-control ${className}`} {...rest} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return <select className={`mid-settings-control ${className}`} {...rest} />;
}

export function Field({ label, help, children, trailing }: { label: string; help?: string; children: ReactNode; trailing?: ReactNode }) {
  return (
    <label className="mid-field">
      <span className="mid-field-row"><span className="mid-label">{label}</span>{trailing}</span>
      {children}
      {help ? <span className="mid-help">{help}</span> : null}
    </label>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "danger" | "success"; children: ReactNode }) {
  if (!children) return null;
  return <div className={`mid-alert mid-alert--${tone}`} role={tone === "danger" ? "alert" : undefined}>{children}</div>;
}

/** Settings-style card: header (title + description + optional action) and body. */
export function Group({ title, description, icon, action, flush, children }: { title: string; description?: string; icon?: IconName; action?: ReactNode; flush?: boolean; children: ReactNode }) {
  return (
    <section className="mid-settings-group">
      <header className="mid-settings-group__header">
        {icon ? <Icon name={icon} className="mid-icon--muted" /> : null}
        <div className="mid-settings-group__header-text">
          <h3 className="mid-settings-group__title">{title}</h3>
          {description ? <p className="mid-settings-group__description">{description}</p> : null}
        </div>
        {action}
      </header>
      <div className={`mid-settings-group__body${flush ? " mid-settings-group__body--flush" : ""}`}>{children}</div>
    </section>
  );
}

export function Row({ label, description, inline = true, children }: { label: string; description?: string; inline?: boolean; children?: ReactNode }) {
  return (
    <div className={`mid-setting-row${inline ? " mid-setting-row--inline" : ""}`}>
      <div className="mid-setting-row__text">
        <div className="mid-setting-row__label">{label}</div>
        {description ? <p className="mid-setting-row__description">{description}</p> : null}
      </div>
      {children ? <div className="mid-setting-row__control">{children}</div> : null}
    </div>
  );
}

export function Chip({ tone, children }: { tone?: "ok" | "warn" | "accent"; children: ReactNode }) {
  return <span className={`mid-chip${tone ? ` mid-chip--${tone}` : ""}`}>{children}</span>;
}
export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="mid-kbd">{children}</kbd>;

/** Full-screen launch loader — identical to the desktop's #mid-loader. */
export function Loader({ label = "Mark It Down" }: { label?: string }) {
  return (
    <div className="mid-loader" aria-hidden="true">
      <div className="mid-loader-inner"><div className="mid-loader-glyph" /><div className="mid-loader-label">{label}</div></div>
    </div>
  );
}

export function Frame({ title, children, footer, headerExtra }: { title?: string; children: ReactNode; footer?: ReactNode; headerExtra?: ReactNode }) {
  return (
    <div className="mid-frame">
      {title ? <header className="mid-frame-header"><h2 className="mid-frame-title">{title}</h2>{headerExtra}</header> : null}
      <div className="mid-frame-body">{children}</div>
      {footer ? <footer className="mid-frame-footer">{footer}</footer> : null}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="mid-modal-backdrop mid-anim-fade" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mid-anim-scale-in" style={{ display: "contents" }}>
        <Frame title={title} headerExtra={<Button variant="ghost" iconOnly icon="x" onClick={onClose} aria-label="Close" />} footer={footer}>{children}</Frame>
      </div>
    </div>
  );
}

// ---- Toasts ----
type Toast = { id: number; kind: "success" | "error"; msg: string };
const ToastCtx = createContext<{ toast: (msg: string, kind?: "success" | "error") => void }>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((msg: string, kind: "success" | "error" = "success") => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, msg }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="mid-toasts" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`mid-toast mid-anim-slide-up${t.kind === "error" ? " mid-toast--error" : ""}`}><Icon name={t.kind === "error" ? "x" : "check"} size="sm" />{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
