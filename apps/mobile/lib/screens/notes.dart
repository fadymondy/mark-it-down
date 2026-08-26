// Notes warehouse — the desktop notes sidebar as a mobile list: filter field,
// category chip strip, note rows (type chip · title · meta · share badge),
// pull-to-refresh, and a New action.
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../api/notes.dart';
import '../main.dart';
import '../theme/tokens.dart';
import 'editor.dart';
import 'settings.dart';

class NotesScreen extends StatefulWidget {
  const NotesScreen({super.key});
  @override
  State<NotesScreen> createState() => _NotesScreenState();
}

class _NotesScreenState extends State<NotesScreen> {
  final _api = NotesApi();
  final _filter = TextEditingController();
  List<Note> _notes = [];
  String _category = '';
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() { _loading = _notes.isEmpty; _error = null; });
    try {
      final rows = await _api.list(query: _filter.text.trim(), category: _category);
      if (mounted) setState(() { _notes = rows; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  List<String> get _categories =>
      {for (final n in _notes) if ((n.category ?? '').isNotEmpty) n.category!}.toList()..sort();

  Future<void> _open([Note? note]) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => EditorScreen(note: note)),
    );
    if (changed == true) _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final p = MidPaletteScope.of(context);
    final fmt = DateFormat.yMMMd();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notes'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined, size: 20),
            tooltip: 'Settings',
            onPressed: () async {
              await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SettingsScreen()));
              _refresh();
            },
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: p.accent, foregroundColor: p.accentFg,
        onPressed: () => _open(),
        child: const Icon(Icons.add),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(MidTokens.s3, MidTokens.s3, MidTokens.s3, 0),
          child: TextField(
            controller: _filter,
            decoration: InputDecoration(
              hintText: 'Filter notes…',
              prefixIcon: Icon(Icons.search, size: 18, color: p.fgSubtle),
              suffixIcon: _filter.text.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.close, size: 16),
                      onPressed: () { _filter.clear(); _refresh(); },
                    ),
            ),
            onChanged: (_) => _refresh(),
          ),
        ),
        if (_categories.isNotEmpty)
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: MidTokens.s3, vertical: MidTokens.s2),
              children: [
                _chip(p, 'All', _category.isEmpty, () { setState(() => _category = ''); _refresh(); }),
                for (final c in _categories)
                  _chip(p, c, _category == c, () { setState(() => _category = c); _refresh(); }),
              ],
            ),
          ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _refresh,
            child: _loading
                ? const Center(child: CircularProgressIndicator(strokeWidth: 2.5))
                : _error != null
                    ? _empty(p, Icons.cloud_off_outlined, _error!)
                    : _notes.isEmpty
                        ? _empty(p, Icons.bookmark_border, 'No notes yet — create your first one.')
                        : ListView.separated(
                            padding: const EdgeInsets.symmetric(vertical: MidTokens.s1),
                            itemCount: _notes.length,
                            separatorBuilder: (_, _) => Divider(color: p.border.withValues(alpha: 0.6)),
                            itemBuilder: (context, i) {
                              final n = _notes[i];
                              return ListTile(
                                onTap: () => _open(n),
                                leading: Container(
                                  width: 32, height: 32, alignment: Alignment.center,
                                  decoration: BoxDecoration(
                                    border: Border.all(color: p.border),
                                    borderRadius: BorderRadius.circular(MidTokens.rSm),
                                  ),
                                  child: Icon(Icons.notes, size: 16, color: p.fgMuted),
                                ),
                                title: Text(n.title,
                                    maxLines: 1, overflow: TextOverflow.ellipsis,
                                    style: TextStyle(fontSize: MidTokens.fsSm + 2, fontWeight: FontWeight.w500, color: p.fg)),
                                subtitle: Text(
                                  [
                                    fmt.format(n.updatedAt.toLocal()),
                                    if ((n.category ?? '').isNotEmpty) n.category!,
                                    if (n.tagList.isNotEmpty) n.tagList.take(3).join(' · '),
                                  ].join('  ·  '),
                                  maxLines: 1, overflow: TextOverflow.ellipsis,
                                  style: TextStyle(fontSize: MidTokens.fsXs + 1, color: p.fgMuted),
                                ),
                                trailing: n.isPublic ? Icon(Icons.link, size: 16, color: p.link) : null,
                              );
                            },
                          ),
          ),
        ),
      ]),
    );
  }

  Widget _chip(MidPalette p, String label, bool active, VoidCallback onTap) => Padding(
        padding: const EdgeInsets.only(right: MidTokens.s1),
        child: GestureDetector(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: MidTokens.s3, vertical: 4),
            decoration: BoxDecoration(
              color: active ? p.fg : p.bg,
              border: Border.all(color: active ? p.fg : p.border),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(label,
                style: TextStyle(fontSize: MidTokens.fsXs + 1, color: active ? p.bg : p.fgMuted)),
          ),
        ),
      );

  Widget _empty(MidPalette p, IconData icon, String msg) => ListView(children: [
        const SizedBox(height: 120),
        Icon(icon, size: 36, color: p.fgSubtle),
        const SizedBox(height: MidTokens.s3),
        Center(child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: MidTokens.s6),
          child: Text(msg, textAlign: TextAlign.center, style: TextStyle(color: p.fgMuted, fontSize: MidTokens.fsSm + 1)),
        )),
      ]);
}
