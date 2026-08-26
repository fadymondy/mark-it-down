// App-wide state: theme choice (auto / light / dark / sepia / any of the 25
// named themes — same modes and storage semantics as the desktop and web apps)
// and the signed-in session.
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api/client.dart';
import 'theme/themes.g.dart';
import 'theme/tokens.dart';

class AppState extends ChangeNotifier {
  static final AppState instance = AppState._();
  AppState._();

  String themeMode = 'auto'; // auto | light | dark | sepia | theme:<id>
  bool loggedIn = false;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    themeMode = prefs.getString('mid-theme') ?? 'auto';
    await ApiClient.instance.load();
    loggedIn = ApiClient.instance.isLoggedIn;
  }

  Future<void> setThemeMode(String mode) async {
    themeMode = mode;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('mid-theme', mode);
  }

  void setLoggedIn(bool v) {
    loggedIn = v;
    notifyListeners();
  }

  MidPalette paletteFor(Brightness platformBrightness) {
    if (themeMode.startsWith('theme:')) {
      final id = themeMode.substring(6);
      final named = kMidThemes.where((t) => t.id == id).firstOrNull;
      if (named != null) return MidPalette.fromNamed(named);
    }
    return switch (themeMode) {
      'light' => MidPalette.light,
      'dark' => MidPalette.dark,
      'sepia' => MidPalette.sepia,
      _ => platformBrightness == Brightness.dark ? MidPalette.dark : MidPalette.light,
    };
  }
}
