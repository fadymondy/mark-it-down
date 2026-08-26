// Mark It Down design tokens — the mobile mirror of packages/ui-tokens/tokens.css.
// Same zinc (shadcn-neutral) light/dark/sepia palettes, spacing, radii, and type
// scale the desktop, web, and Chrome apps use, expressed as Flutter ThemeData.
import 'package:flutter/material.dart';
import 'themes.g.dart';

class MidPalette {
  final Color bg, surface, surfaceHover, fg, fgMuted, fgSubtle, border, borderStrong;
  final Color accent, accentFg, link, codeBg, inlineCodeBg, tableStripe, danger, success;
  final bool isDark;
  const MidPalette({
    required this.bg, required this.surface, required this.surfaceHover,
    required this.fg, required this.fgMuted, required this.fgSubtle,
    required this.border, required this.borderStrong,
    required this.accent, required this.accentFg, required this.link,
    required this.codeBg, required this.inlineCodeBg, required this.tableStripe,
    required this.danger, required this.success, required this.isDark,
  });

  // tokens.css :root (light — zinc)
  static const light = MidPalette(
    bg: Color(0xFFFFFFFF), surface: Color(0xFFF4F4F5), surfaceHover: Color(0xFFE4E4E7),
    fg: Color(0xFF09090B), fgMuted: Color(0xFF71717A), fgSubtle: Color(0xFFA1A1AA),
    border: Color(0xFFE4E4E7), borderStrong: Color(0xFFD4D4D8),
    accent: Color(0xFF18181B), accentFg: Color(0xFFFAFAFA), link: Color(0xFF2563EB),
    codeBg: Color(0xFFFAFAFA), inlineCodeBg: Color(0x2EA1A1AA), tableStripe: Color(0xFFFAFAFA),
    danger: Color(0xFFDC2626), success: Color(0xFF16A34A), isDark: false,
  );

  // tokens.css :root.dark
  static const dark = MidPalette(
    bg: Color(0xFF09090B), surface: Color(0xFF18181B), surfaceHover: Color(0xFF27272A),
    fg: Color(0xFFFAFAFA), fgMuted: Color(0xFFA1A1AA), fgSubtle: Color(0xFF71717A),
    border: Color(0xFF27272A), borderStrong: Color(0xFF3F3F46),
    accent: Color(0xFFFAFAFA), accentFg: Color(0xFF18181B), link: Color(0xFF60A5FA),
    codeBg: Color(0xFF18181B), inlineCodeBg: Color(0x993F3F46), tableStripe: Color(0xFF18181B),
    danger: Color(0xFFF87171), success: Color(0xFF4ADE80), isDark: true,
  );

  // tokens.css :root.sepia
  static const sepia = MidPalette(
    bg: Color(0xFFF4ECD8), surface: Color(0xFFEBE1C7), surfaceHover: Color(0xFFDDD2B3),
    fg: Color(0xFF433422), fgMuted: Color(0xFF6F5D44), fgSubtle: Color(0xFF8A7758),
    border: Color(0xFFC8B894), borderStrong: Color(0xFFB09F7C),
    accent: Color(0xFFA06B2A), accentFg: Color(0xFFFDF8EC), link: Color(0xFF8A4A14),
    codeBg: Color(0xFFEBE1C7), inlineCodeBg: Color(0x2EA06B2A), tableStripe: Color(0xFFEBE1C7),
    danger: Color(0xFFDC2626), success: Color(0xFF16A34A), isDark: false,
  );

  /// A named theme (github-dark, dracula, nord, …) mapped onto the token slots —
  /// mirrors the desktop's applyNamedTheme(): surface derives from codeBg, the
  /// accent chip keeps fg-on-bg contrast.
  factory MidPalette.fromNamed(MidNamedTheme t) {
    final base = t.isDark ? dark : light;
    return MidPalette(
      bg: t.bg, surface: t.codeBg,
      surfaceHover: Color.lerp(t.codeBg, t.fg, 0.08)!,
      fg: t.fg, fgMuted: t.fgMuted, fgSubtle: Color.lerp(t.fgMuted, t.bg, 0.3)!,
      border: t.border, borderStrong: Color.lerp(t.border, t.fg, 0.2)!,
      accent: t.accent, accentFg: t.isDark ? const Color(0xFF18181B) : const Color(0xFFFAFAFA),
      link: t.link, codeBg: t.codeBg, inlineCodeBg: t.inlineCodeBg,
      tableStripe: t.tableStripe, danger: base.danger, success: base.success, isDark: t.isDark,
    );
  }
}

/// Spacing (4px base), radii, and font sizes from tokens.css.
class MidTokens {
  static const s1 = 4.0, s2 = 8.0, s3 = 12.0, s4 = 16.0, s5 = 20.0, s6 = 24.0, s8 = 32.0;
  static const rXs = 2.0, rSm = 4.0, rMd = 6.0, rLg = 8.0, rXl = 12.0;
  static const fsXs = 11.0, fsSm = 12.0, fsBase = 16.0, fsReading = 17.0, fsLg = 18.0, fsXl = 20.0, fs2xl = 24.0;
}

ThemeData midThemeData(MidPalette p) {
  final brightness = p.isDark ? Brightness.dark : Brightness.light;
  final scheme = ColorScheme(
    brightness: brightness,
    primary: p.accent, onPrimary: p.accentFg,
    secondary: p.link, onSecondary: p.bg,
    error: p.danger, onError: Colors.white,
    surface: p.bg, onSurface: p.fg,
    surfaceContainerHighest: p.surface,
    outline: p.border, outlineVariant: p.borderStrong,
  );
  final radiusMd = BorderRadius.circular(MidTokens.rMd);
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: p.bg,
    canvasColor: p.bg,
    dividerColor: p.border,
    hintColor: p.fgSubtle,
    splashFactory: NoSplash.splashFactory,
    appBarTheme: AppBarTheme(
      backgroundColor: p.bg, foregroundColor: p.fg, elevation: 0, scrolledUnderElevation: 0,
      centerTitle: true,
      titleTextStyle: TextStyle(color: p.fg, fontSize: MidTokens.fsBase, fontWeight: FontWeight.w600),
      shape: Border(bottom: BorderSide(color: p.border)),
    ),
    cardTheme: CardThemeData(
      color: p.bg, elevation: 0, margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(MidTokens.rLg), side: BorderSide(color: p.border)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      isDense: true,
      filled: true, fillColor: p.bg,
      contentPadding: const EdgeInsets.symmetric(horizontal: MidTokens.s3, vertical: 10),
      border: OutlineInputBorder(borderRadius: radiusMd, borderSide: BorderSide(color: p.border)),
      enabledBorder: OutlineInputBorder(borderRadius: radiusMd, borderSide: BorderSide(color: p.border)),
      focusedBorder: OutlineInputBorder(borderRadius: radiusMd, borderSide: BorderSide(color: p.borderStrong, width: 1.5)),
      labelStyle: TextStyle(color: p.fgMuted, fontSize: MidTokens.fsSm),
      hintStyle: TextStyle(color: p.fgSubtle, fontSize: MidTokens.fsSm + 1),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: p.accent, foregroundColor: p.accentFg,
        shape: RoundedRectangleBorder(borderRadius: radiusMd),
        textStyle: const TextStyle(fontSize: MidTokens.fsSm + 1, fontWeight: FontWeight.w500),
        minimumSize: const Size(0, 40),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: p.fg, side: BorderSide(color: p.border),
        shape: RoundedRectangleBorder(borderRadius: radiusMd),
        textStyle: const TextStyle(fontSize: MidTokens.fsSm + 1, fontWeight: FontWeight.w500),
        minimumSize: const Size(0, 40),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: p.link,
        textStyle: const TextStyle(fontSize: MidTokens.fsSm + 1, fontWeight: FontWeight.w500),
      ),
    ),
    listTileTheme: ListTileThemeData(
      dense: true, iconColor: p.fgMuted, textColor: p.fg,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(MidTokens.rSm)),
    ),
    dividerTheme: DividerThemeData(color: p.border, thickness: 1, space: 1),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: p.fg, contentTextStyle: TextStyle(color: p.bg, fontSize: MidTokens.fsSm + 1),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: radiusMd),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: p.surface, side: BorderSide(color: p.border),
      labelStyle: TextStyle(color: p.fgMuted, fontSize: MidTokens.fsXs),
      padding: const EdgeInsets.symmetric(horizontal: MidTokens.s2),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: p.bg,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(MidTokens.rLg), side: BorderSide(color: p.border)),
      titleTextStyle: TextStyle(color: p.fg, fontSize: MidTokens.fsLg, fontWeight: FontWeight.w600),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: p.fg, linearTrackColor: p.border, circularTrackColor: p.border),
    tabBarTheme: TabBarThemeData(labelColor: p.fg, unselectedLabelColor: p.fgMuted, indicatorColor: p.fg),
  );
}
