// Generate lib/theme/themes.g.dart from packages/core/src/themes/themes.ts —
// same source of truth the desktop, web, and Chrome extension use.
import fs from "node:fs";
const src = fs.readFileSync("packages/core/src/themes/themes.ts", "utf8");
const themes = [];
const re = /\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)',\s*kind:\s*'([^']+)',\s*palette:\s*\{([\s\S]*?)\},\s*\}/g;
let m;
while ((m = re.exec(src))) {
  const [, id, label, kind, body] = m;
  const p = {};
  const pre = /(\w+):\s*'([^']+)'/g; let pm;
  while ((pm = pre.exec(body))) p[pm[1]] = pm[2];
  themes.push({ id, label, kind, p });
}
if (themes.length < 20) { console.error("only parsed", themes.length, "themes"); process.exit(1); }
const dartColor = (v) => {
  if (v.startsWith("#")) {
    let h = v.slice(1);
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    return `Color(0xFF${h.toUpperCase()})`;
  }
  const rgba = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgba) {
    const a = Math.round((rgba[4] !== undefined ? parseFloat(rgba[4]) : 1) * 255);
    const hex = (n) => Number(n).toString(16).padStart(2, "0").toUpperCase();
    return `Color(0x${hex(a)}${hex(rgba[1])}${hex(rgba[2])}${hex(rgba[3])})`;
  }
  throw new Error("unparseable color: " + v);
};
let out = `// GENERATED from packages/core/src/themes/themes.ts — do not edit.
// Regenerate: node scripts/gen-mobile-themes.mjs (run from the repo root).
import 'package:flutter/material.dart';

class MidNamedTheme {
  final String id;
  final String label;
  final bool isDark;
  final Color bg, fg, fgMuted, border, link, linkHover, codeBg, inlineCodeBg, tableStripe, accent;
  const MidNamedTheme({
    required this.id, required this.label, required this.isDark,
    required this.bg, required this.fg, required this.fgMuted, required this.border,
    required this.link, required this.linkHover, required this.codeBg,
    required this.inlineCodeBg, required this.tableStripe, required this.accent,
  });
}

const List<MidNamedTheme> kMidThemes = [
`;
for (const t of themes) {
  out += `  MidNamedTheme(
    id: '${t.id}', label: '${t.label.replace(/'/g, "\'")}', isDark: ${t.kind === "dark"},
    bg: ${dartColor(t.p.bg)}, fg: ${dartColor(t.p.fg)}, fgMuted: ${dartColor(t.p.fgMuted)},
    border: ${dartColor(t.p.border)}, link: ${dartColor(t.p.link)}, linkHover: ${dartColor(t.p.linkHover)},
    codeBg: ${dartColor(t.p.codeBg)}, inlineCodeBg: ${dartColor(t.p.inlineCodeBg)},
    tableStripe: ${dartColor(t.p.tableStripe)}, accent: ${dartColor(t.p.accent)},
  ),
`;
}
out += "];\n";
fs.mkdirSync("apps/mobile/lib/theme", { recursive: true });
fs.writeFileSync("apps/mobile/lib/theme/themes.g.dart", out);
console.log("generated", themes.length, "themes → apps/mobile/lib/theme/themes.g.dart");
