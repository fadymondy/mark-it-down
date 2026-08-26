import { ReactNode } from "react";
import { ThemeProvider } from "./lib/theme";
import { LangProvider } from "./lib/i18n";
import { ToastProvider } from "./components/ui";

// Same providers the desktop app effectively has: theme engine (auto/light/dark/sepia
// + the 25 named themes), language (EN/AR + RTL), and toasts.
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <LangProvider>
        <ToastProvider>{children}</ToastProvider>
      </LangProvider>
    </ThemeProvider>
  );
}
