// Minimal EN/AR language context (RTL-aware) — replaces the ToGo kit's useT so the
// bilingual strings keep working without the kit.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "en" | "ar";
const KEY = "mid-lang";
interface LangCtx { lang: Lang; ar: boolean; dir: "ltr" | "rtl"; setLang: (l: Lang) => void; t: (en: string, ar: string) => string }
const Ctx = createContext<LangCtx>({ lang: "en", ar: false, dir: "ltr", setLang: () => {}, t: (en) => en });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => { try { return (localStorage.getItem(KEY) as Lang) || "en"; } catch { return "en"; } });
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  const value = useMemo<LangCtx>(() => ({
    lang, ar: lang === "ar", dir: lang === "ar" ? "rtl" : "ltr",
    setLang: (l) => { try { localStorage.setItem(KEY, l); } catch {} setLangState(l); },
    t: (en, ar) => (lang === "ar" ? ar : en),
  }), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useLang = () => useContext(Ctx);
