// Settings — the desktop settings page's group-card structure: Account,
// Appearance (mode pills + the 25 named theme swatches), and Server.
import 'package:flutter/material.dart';
import '../api/client.dart';
import '../app_state.dart';
import '../main.dart';
import '../theme/themes.g.dart';
import '../theme/tokens.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _server = TextEditingController(text: ApiClient.instance.server);

  @override
  Widget build(BuildContext context) {
    final p = MidPaletteScope.of(context);
    final state = AppState.instance;
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(MidTokens.s4),
        children: [
          _group(p, 'Account', ApiClient.instance.userEmail ?? '', [
            Row(children: [
              Expanded(
                child: Text('Signed in to the notes warehouse.',
                    style: TextStyle(fontSize: MidTokens.fsSm + 1, color: p.fgMuted)),
              ),
              OutlinedButton(
                onPressed: () async {
                  await ApiClient.instance.logout();
                  AppState.instance.setLoggedIn(false);
                  if (context.mounted) Navigator.of(context).popUntil((r) => r.isFirst);
                },
                child: const Text('Sign out'),
              ),
            ]),
          ]),
          const SizedBox(height: MidTokens.s4),
          _group(p, 'Appearance', 'Same themes as the desktop, web, and VSCode apps.', [
            Wrap(spacing: MidTokens.s2, runSpacing: MidTokens.s2, children: [
              for (final (id, label) in [('auto', 'System'), ('light', 'Light'), ('dark', 'Dark'), ('sepia', 'Sepia')])
                _pill(p, label, state.themeMode == id, () => state.setThemeMode(id)),
            ]),
            const SizedBox(height: MidTokens.s4),
            Text('Named themes',
                style: TextStyle(fontSize: MidTokens.fsSm, fontWeight: FontWeight.w500, color: p.fg)),
            const SizedBox(height: MidTokens.s2),
            Wrap(spacing: MidTokens.s2, runSpacing: MidTokens.s2, children: [
              for (final t in kMidThemes) _swatch(p, t, state),
            ]),
          ]),
          const SizedBox(height: MidTokens.s4),
          _group(p, 'Server', 'The warehouse this app syncs with.', [
            TextField(
              controller: _server,
              keyboardType: TextInputType.url,
              autocorrect: false,
              decoration: const InputDecoration(labelText: 'Server URL'),
            ),
            const SizedBox(height: MidTokens.s3),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton(
                onPressed: () async {
                  await ApiClient.instance.setServer(_server.text.trim());
                  if (context.mounted) {
                    ScaffoldMessenger.of(context)
                        .showSnackBar(const SnackBar(content: Text('Server saved — sign in again if needed.')));
                  }
                },
                child: const Text('Save server'),
              ),
            ),
          ]),
        ],
      ),
    );
  }

  Widget _group(MidPalette p, String title, String description, List<Widget> children) => Container(
        decoration: BoxDecoration(
          color: p.bg,
          border: Border.all(color: p.border),
          borderRadius: BorderRadius.circular(MidTokens.rLg),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Container(
            color: p.surface,
            padding: const EdgeInsets.symmetric(horizontal: MidTokens.s5, vertical: MidTokens.s4),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: TextStyle(fontSize: MidTokens.fsBase, fontWeight: FontWeight.w600, color: p.fg)),
              if (description.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(description, style: TextStyle(fontSize: MidTokens.fsSm, color: p.fgMuted)),
              ],
            ]),
          ),
          Divider(color: p.border),
          Padding(
            padding: const EdgeInsets.all(MidTokens.s5),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
          ),
        ]),
      );

  Widget _pill(MidPalette p, String label, bool active, VoidCallback onTap) => GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: MidTokens.s4, vertical: 10),
          decoration: BoxDecoration(
            color: active ? p.accent : p.bg,
            border: Border.all(color: active ? p.accent : p.border),
            borderRadius: BorderRadius.circular(MidTokens.rMd),
          ),
          child: Text(label,
              style: TextStyle(fontSize: MidTokens.fsSm + 1, color: active ? p.accentFg : p.fg)),
        ),
      );

  Widget _swatch(MidPalette p, MidNamedTheme t, AppState state) {
    final active = state.themeMode == 'theme:${t.id}';
    return GestureDetector(
      onTap: () => state.setThemeMode('theme:${t.id}'),
      child: Container(
        width: 150,
        padding: const EdgeInsets.symmetric(horizontal: MidTokens.s2, vertical: 6),
        decoration: BoxDecoration(
          border: Border.all(color: active ? p.fg : p.border, width: active ? 2 : 1),
          borderRadius: BorderRadius.circular(MidTokens.rMd),
        ),
        child: Row(children: [
          Container(
            width: 22, height: 22,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: Colors.black12),
              gradient: LinearGradient(
                begin: Alignment.topLeft, end: Alignment.bottomRight,
                colors: [t.bg, t.bg, t.accent, t.accent],
                stops: const [0, 0.5, 0.5, 1],
              ),
            ),
          ),
          const SizedBox(width: MidTokens.s2),
          Expanded(
            child: Text(t.label,
                maxLines: 1, overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: MidTokens.fsXs + 1, color: p.fg)),
          ),
        ]),
      ),
    );
  }
}
