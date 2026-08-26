// Mark It Down — mobile companion (Android/iOS). Same design system, brand,
// and warehouse backend as the desktop, VSCode, Chrome, and web apps.
import 'package:flutter/material.dart';
import 'app_state.dart';
import 'screens/login.dart';
import 'screens/notes.dart';
import 'theme/tokens.dart';
import 'widgets/brand.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppState.instance.load();
  runApp(const MarkItDownApp());
}

class MarkItDownApp extends StatelessWidget {
  const MarkItDownApp({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return ListenableBuilder(
      listenable: state,
      builder: (context, _) {
        final platformBrightness = MediaQuery.maybePlatformBrightnessOf(context) ??
            WidgetsBinding.instance.platformDispatcher.platformBrightness;
        final palette = state.paletteFor(platformBrightness);
        return MidPaletteScope(
          palette: palette,
          child: MaterialApp(
            title: 'Mark It Down',
            debugShowCheckedModeBanner: false,
            theme: midThemeData(palette),
            home: state.loggedIn ? const NotesScreen() : const LoginScreen(),
          ),
        );
      },
    );
  }
}

/// Makes the active MidPalette available below the MaterialApp (screens read
/// token colors that ThemeData has no slot for — surface, muted text, chips).
class MidPaletteScope extends InheritedWidget {
  final MidPalette palette;
  const MidPaletteScope({super.key, required this.palette, required super.child});

  static MidPalette of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<MidPaletteScope>()!.palette;

  @override
  bool updateShouldNotify(MidPaletteScope oldWidget) => oldWidget.palette != palette;
}

/// The desktop's launch-loader (spinner ring + wordmark), used while async
/// boots resolve.
class MidLoader extends StatelessWidget {
  const MidLoader({super.key});
  @override
  Widget build(BuildContext context) {
    final p = MidPaletteScope.of(context);
    return Scaffold(
      body: Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const MarkItDownMark(size: 64),
          const SizedBox(height: MidTokens.s4),
          SizedBox(
            width: 22, height: 22,
            child: CircularProgressIndicator(strokeWidth: 2.5, color: p.fg, backgroundColor: p.border),
          ),
          const SizedBox(height: MidTokens.s3),
          Text('Mark It Down',
              style: TextStyle(color: p.fgMuted, fontSize: MidTokens.fsSm, letterSpacing: 0.5)),
        ]),
      ),
    );
  }
}
