// GENERATED from packages/core/src/themes/themes.ts — do not edit.
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
  MidNamedTheme(
    id: 'github-light', label: 'GitHub Light', isDark: false,
    bg: Color(0xFFFFFFFF), fg: Color(0xFF1F2328), fgMuted: Color(0xFF656D76),
    border: Color(0xFFD0D7DE), link: Color(0xFF0969DA), linkHover: Color(0xFF0550AE),
    codeBg: Color(0xFFF6F8FA), inlineCodeBg: Color(0x33AFB8C1),
    tableStripe: Color(0xFFF6F8FA), accent: Color(0xFF0969DA),
  ),
  MidNamedTheme(
    id: 'github-dark', label: 'GitHub Dark', isDark: true,
    bg: Color(0xFF0D1117), fg: Color(0xFFE6EDF3), fgMuted: Color(0xFF7D8590),
    border: Color(0xFF30363D), link: Color(0xFF2F81F7), linkHover: Color(0xFF58A6FF),
    codeBg: Color(0xFF161B22), inlineCodeBg: Color(0x666E7681),
    tableStripe: Color(0xFF161B22), accent: Color(0xFF2F81F7),
  ),
  MidNamedTheme(
    id: 'dracula', label: 'Dracula', isDark: true,
    bg: Color(0xFF282A36), fg: Color(0xFFF8F8F2), fgMuted: Color(0xFF6272A4),
    border: Color(0xFF44475A), link: Color(0xFF8BE9FD), linkHover: Color(0xFFBD93F9),
    codeBg: Color(0xFF21222C), inlineCodeBg: Color(0xFF44475A),
    tableStripe: Color(0xFF2F3243), accent: Color(0xFFBD93F9),
  ),
  MidNamedTheme(
    id: 'one-dark', label: 'Atom One Dark', isDark: true,
    bg: Color(0xFF282C34), fg: Color(0xFFABB2BF), fgMuted: Color(0xFF7F848E),
    border: Color(0xFF3E4451), link: Color(0xFF61AFEF), linkHover: Color(0xFF56B6C2),
    codeBg: Color(0xFF21252B), inlineCodeBg: Color(0xFF3E4451),
    tableStripe: Color(0xFF2C313C), accent: Color(0xFFC678DD),
  ),
  MidNamedTheme(
    id: 'one-light', label: 'Atom One Light', isDark: false,
    bg: Color(0xFFFAFAFA), fg: Color(0xFF383A42), fgMuted: Color(0xFFA0A1A7),
    border: Color(0xFFE5E5E6), link: Color(0xFF4078F2), linkHover: Color(0xFF0184BB),
    codeBg: Color(0xFFF0F0F1), inlineCodeBg: Color(0xFFE5E5E6),
    tableStripe: Color(0xFFF5F5F6), accent: Color(0xFFA626A4),
  ),
  MidNamedTheme(
    id: 'monokai', label: 'Monokai', isDark: true,
    bg: Color(0xFF272822), fg: Color(0xFFF8F8F2), fgMuted: Color(0xFF75715E),
    border: Color(0xFF3E3D32), link: Color(0xFF66D9EF), linkHover: Color(0xFFA6E22E),
    codeBg: Color(0xFF1E1F1C), inlineCodeBg: Color(0xFF3E3D32),
    tableStripe: Color(0xFF2D2E26), accent: Color(0xFFF92672),
  ),
  MidNamedTheme(
    id: 'solarized-light', label: 'Solarized Light', isDark: false,
    bg: Color(0xFFFDF6E3), fg: Color(0xFF586E75), fgMuted: Color(0xFF93A1A1),
    border: Color(0xFFEEE8D5), link: Color(0xFF268BD2), linkHover: Color(0xFF2AA198),
    codeBg: Color(0xFFEEE8D5), inlineCodeBg: Color(0xFFEEE8D5),
    tableStripe: Color(0xFFF5EFDC), accent: Color(0xFFCB4B16),
  ),
  MidNamedTheme(
    id: 'solarized-dark', label: 'Solarized Dark', isDark: true,
    bg: Color(0xFF002B36), fg: Color(0xFF839496), fgMuted: Color(0xFF586E75),
    border: Color(0xFF073642), link: Color(0xFF268BD2), linkHover: Color(0xFF2AA198),
    codeBg: Color(0xFF073642), inlineCodeBg: Color(0xFF073642),
    tableStripe: Color(0xFF02303C), accent: Color(0xFFB58900),
  ),
  MidNamedTheme(
    id: 'tokyo-night', label: 'Tokyo Night', isDark: true,
    bg: Color(0xFF1A1B26), fg: Color(0xFFA9B1D6), fgMuted: Color(0xFF565F89),
    border: Color(0xFF292E42), link: Color(0xFF7AA2F7), linkHover: Color(0xFFBB9AF7),
    codeBg: Color(0xFF16161E), inlineCodeBg: Color(0xFF292E42),
    tableStripe: Color(0xFF1F2335), accent: Color(0xFFBB9AF7),
  ),
  MidNamedTheme(
    id: 'tokyo-night-light', label: 'Tokyo Night Light', isDark: false,
    bg: Color(0xFFD5D6DB), fg: Color(0xFF343B58), fgMuted: Color(0xFF6C6E75),
    border: Color(0xFFA8AECB), link: Color(0xFF34548A), linkHover: Color(0xFF5A4A78),
    codeBg: Color(0xFFCBCCD1), inlineCodeBg: Color(0xFFCBCCD1),
    tableStripe: Color(0xFFCDCED3), accent: Color(0xFF5A4A78),
  ),
  MidNamedTheme(
    id: 'ayu-light', label: 'Ayu Light', isDark: false,
    bg: Color(0xFFFAFAFA), fg: Color(0xFF5C6166), fgMuted: Color(0xFF828C99),
    border: Color(0xFFE7EAED), link: Color(0xFF399EE6), linkHover: Color(0xFF86B300),
    codeBg: Color(0xFFF3F3F3), inlineCodeBg: Color(0xFFE7EAED),
    tableStripe: Color(0xFFF1F1F1), accent: Color(0xFFFA8D3E),
  ),
  MidNamedTheme(
    id: 'ayu-mirage', label: 'Ayu Mirage', isDark: true,
    bg: Color(0xFF1F2430), fg: Color(0xFFCBCCC6), fgMuted: Color(0xFF707A8C),
    border: Color(0xFF34455A), link: Color(0xFF73D0FF), linkHover: Color(0xFFBAE67E),
    codeBg: Color(0xFF191E2A), inlineCodeBg: Color(0xFF34455A),
    tableStripe: Color(0xFF242936), accent: Color(0xFFFFCC66),
  ),
  MidNamedTheme(
    id: 'ayu-dark', label: 'Ayu Dark', isDark: true,
    bg: Color(0xFF0A0E14), fg: Color(0xFFB3B1AD), fgMuted: Color(0xFF5C6773),
    border: Color(0xFF11151C), link: Color(0xFF39BAE6), linkHover: Color(0xFFAAD94C),
    codeBg: Color(0xFF0D1017), inlineCodeBg: Color(0xFF11151C),
    tableStripe: Color(0xFF0E131C), accent: Color(0xFFF29668),
  ),
  MidNamedTheme(
    id: 'gruvbox-light', label: 'Gruvbox Light', isDark: false,
    bg: Color(0xFFFBF1C7), fg: Color(0xFF3C3836), fgMuted: Color(0xFF7C6F64),
    border: Color(0xFFEBDBB2), link: Color(0xFF076678), linkHover: Color(0xFF9D0006),
    codeBg: Color(0xFFF2E5BC), inlineCodeBg: Color(0xFFEBDBB2),
    tableStripe: Color(0xFFF5E9C4), accent: Color(0xFFD65D0E),
  ),
  MidNamedTheme(
    id: 'gruvbox-dark', label: 'Gruvbox Dark', isDark: true,
    bg: Color(0xFF282828), fg: Color(0xFFEBDBB2), fgMuted: Color(0xFF928374),
    border: Color(0xFF3C3836), link: Color(0xFF83A598), linkHover: Color(0xFFFABD2F),
    codeBg: Color(0xFF1D2021), inlineCodeBg: Color(0xFF3C3836),
    tableStripe: Color(0xFF2C2C2C), accent: Color(0xFFFE8019),
  ),
  MidNamedTheme(
    id: 'nord', label: 'Nord', isDark: true,
    bg: Color(0xFF2E3440), fg: Color(0xFFD8DEE9), fgMuted: Color(0xFF7B88A1),
    border: Color(0xFF3B4252), link: Color(0xFF88C0D0), linkHover: Color(0xFF81A1C1),
    codeBg: Color(0xFF3B4252), inlineCodeBg: Color(0xFF434C5E),
    tableStripe: Color(0xFF353C4A), accent: Color(0xFFA3BE8C),
  ),
  MidNamedTheme(
    id: 'nord-light', label: 'Nord Light', isDark: false,
    bg: Color(0xFFECEFF4), fg: Color(0xFF2E3440), fgMuted: Color(0xFF4C566A),
    border: Color(0xFFD8DEE9), link: Color(0xFF5E81AC), linkHover: Color(0xFF81A1C1),
    codeBg: Color(0xFFE5E9F0), inlineCodeBg: Color(0xFFD8DEE9),
    tableStripe: Color(0xFFE8EBF2), accent: Color(0xFFBF616A),
  ),
  MidNamedTheme(
    id: 'palenight', label: 'Palenight', isDark: true,
    bg: Color(0xFF292D3E), fg: Color(0xFFA6ACCD), fgMuted: Color(0xFF676E95),
    border: Color(0xFF34394E), link: Color(0xFF82AAFF), linkHover: Color(0xFFC792EA),
    codeBg: Color(0xFF222533), inlineCodeBg: Color(0xFF34394E),
    tableStripe: Color(0xFF2D3142), accent: Color(0xFFC792EA),
  ),
  MidNamedTheme(
    id: 'material-dark', label: 'Material Dark', isDark: true,
    bg: Color(0xFF263238), fg: Color(0xFFEEFFFF), fgMuted: Color(0xFFB2CCD6),
    border: Color(0xFF37474F), link: Color(0xFF82AAFF), linkHover: Color(0xFFC3E88D),
    codeBg: Color(0xFF1E272C), inlineCodeBg: Color(0xFF37474F),
    tableStripe: Color(0xFF2A363C), accent: Color(0xFFFFCB6B),
  ),
  MidNamedTheme(
    id: 'material-light', label: 'Material Light', isDark: false,
    bg: Color(0xFFFAFAFA), fg: Color(0xFF90A4AE), fgMuted: Color(0xFFB0BEC5),
    border: Color(0xFFCFD8DC), link: Color(0xFF39ADB5), linkHover: Color(0xFF7C4DFF),
    codeBg: Color(0xFFECEFF1), inlineCodeBg: Color(0xFFCFD8DC),
    tableStripe: Color(0xFFF3F5F6), accent: Color(0xFFF76D47),
  ),
  MidNamedTheme(
    id: 'night-owl', label: 'Night Owl', isDark: true,
    bg: Color(0xFF011627), fg: Color(0xFFD6DEEB), fgMuted: Color(0xFF5F7E97),
    border: Color(0xFF1D3B53), link: Color(0xFF82AAFF), linkHover: Color(0xFF7FDBCA),
    codeBg: Color(0xFF01111D), inlineCodeBg: Color(0xFF1D3B53),
    tableStripe: Color(0xFF0A1B29), accent: Color(0xFFC792EA),
  ),
  MidNamedTheme(
    id: 'cobalt2', label: 'Cobalt 2', isDark: true,
    bg: Color(0xFF193549), fg: Color(0xFFFFFFFF), fgMuted: Color(0xFFAAAAAA),
    border: Color(0xFF234E6E), link: Color(0xFFFFC600), linkHover: Color(0xFFFF9D00),
    codeBg: Color(0xFF122738), inlineCodeBg: Color(0xFF234E6E),
    tableStripe: Color(0xFF163C54), accent: Color(0xFFFF628C),
  ),
  MidNamedTheme(
    id: 'oceanic-next', label: 'Oceanic Next', isDark: true,
    bg: Color(0xFF1B2B34), fg: Color(0xFFCDD3DE), fgMuted: Color(0xFF65737E),
    border: Color(0xFF343D46), link: Color(0xFF6699CC), linkHover: Color(0xFF5FB3B3),
    codeBg: Color(0xFF16242D), inlineCodeBg: Color(0xFF343D46),
    tableStripe: Color(0xFF1F303A), accent: Color(0xFFFAC863),
  ),
  MidNamedTheme(
    id: 'snazzy', label: 'Hyper Snazzy', isDark: true,
    bg: Color(0xFF1D1F21), fg: Color(0xFFEFF0EB), fgMuted: Color(0xFFA0A4A8),
    border: Color(0xFF34373C), link: Color(0xFF57C7FF), linkHover: Color(0xFF9AEDFE),
    codeBg: Color(0xFF161718), inlineCodeBg: Color(0xFF34373C),
    tableStripe: Color(0xFF222426), accent: Color(0xFFFF5C57),
  ),
  MidNamedTheme(
    id: 'rose-pine', label: 'Rosé Pine', isDark: true,
    bg: Color(0xFF191724), fg: Color(0xFFE0DEF4), fgMuted: Color(0xFF908CAA),
    border: Color(0xFF26233A), link: Color(0xFF9CCFD8), linkHover: Color(0xFFC4A7E7),
    codeBg: Color(0xFF1F1D2E), inlineCodeBg: Color(0xFF26233A),
    tableStripe: Color(0xFF21202E), accent: Color(0xFFEB6F92),
  ),
];
