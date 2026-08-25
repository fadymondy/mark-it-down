// Theme engine — the desktop app's exact behaviour (apps/electron/renderer/renderer.ts
// applyResolvedTheme / applyNamedTheme), so a theme chosen here looks identical to the
// same choice on desktop. Modes: "auto" (follow OS), "light", "dark", "sepia", or
// "theme:<id>" for one of the 25 packages/core themes (which override the --mid-* vars).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { THEMES, type ThemeDefinition } from "@mid/core/themes";

export type ThemeMode = "auto" | "light" | "dark" | "sepia" | `theme:${string}`;
export const THEME_KEY = "mid-theme";
export { THEMES };

const NAMED_PROPS = ["--mid-bg", "--mid-fg", "--mid-fg-muted", "--mid-border", "--mid-link", "--mid-link-hover", "--mid-code-bg", "--mid-inline-code-bg", "--mid-table-stripe", "--mid-accent", "--mid-surface"];

function applyNamedTheme(theme: ThemeDefinition) {
  const root = document.documentElement;
  root.classList.remove("dark", "sepia");
  if (theme.kind === "dark") root.classList.add("dark");
  const p = theme.palette;
  root.style.setProperty("--mid-bg", p.bg);
  root.style.setProperty("--mid-fg", p.fg);
  root.style.setProperty("--mid-fg-muted", p.fgMuted);
  root.style.setProperty("--mid-border", p.border);
  root.style.setProperty("--mid-link", p.link);
  root.style.setProperty("--mid-link-hover", p.linkHover);
  root.style.setProperty("--mid-code-bg", p.codeBg);
  root.style.setProperty("--mid-inline-code-bg", p.inlineCodeBg);
  root.style.setProperty("--mid-table-stripe", p.tableStripe);
  root.style.setProperty("--mid-accent", p.accent);
  root.style.setProperty("--mid-surface", p.codeBg); // derived, like desktop
}

export function applyThemeMode(mode: ThemeMode, osDark: boolean) {
  const root = document.documentElement;
  if (mode.startsWith("theme:")) {
    const t = THEMES.find((x) => x.id === mode.slice(6));
    if (t) { applyNamedTheme(t); root.dataset.theme = mode; return; }
  }
  for (const p of NAMED_PROPS) root.style.removeProperty(p);
  root.classList.remove("dark", "sepia");
  if (mode === "dark" || (mode === "auto" && osDark)) root.classList.add("dark");
  else if (mode === "sepia") root.classList.add("sepia");
  root.dataset.theme = mode;
}

export function readStoredMode(): ThemeMode {
  try { return (localStorage.getItem(THEME_KEY) as ThemeMode) || "auto"; } catch { return "auto"; }
}

interface ThemeCtx { mode: ThemeMode; setMode: (m: ThemeMode) => void; isDark: boolean }
const Ctx = createContext<ThemeCtx>({ mode: "auto", setMode: () => {}, isDark: false });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [osDark, setOsDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = (e: MediaQueryListEvent) => setOsDark(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  useEffect(() => { applyThemeMode(mode, osDark); }, [mode, osDark]);
  const value = useMemo<ThemeCtx>(() => ({
    mode,
    setMode: (m) => { try { localStorage.setItem(THEME_KEY, m); } catch {} setModeState(m); },
    isDark: mode === "dark" || (mode === "auto" && osDark) || (mode.startsWith("theme:") && THEMES.find((t) => `theme:${t.id}` === mode)?.kind === "dark"),
  }), [mode, osDark]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
