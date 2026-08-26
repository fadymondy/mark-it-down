// Note editor/viewer — the desktop's View / Edit segmented toggle, meta row
// (title · category · tags), markdown preview in the shared reading style, and
// share / copy-link / delete actions.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import '../api/client.dart';
import '../api/notes.dart';
import '../main.dart';
import '../theme/tokens.dart';

class EditorScreen extends StatefulWidget {
  final Note? note;
  const EditorScreen({super.key, this.note});
  @override
  State<EditorScreen> createState() => _EditorScreenState();
}

class _EditorScreenState extends State<EditorScreen> {
  final _api = NotesApi();
  late final TextEditingController _title = TextEditingController(text: widget.note?.title ?? '');
  late final TextEditingController _body = TextEditingController(text: widget.note?.body ?? '');
  late final TextEditingController _category = TextEditingController(text: widget.note?.category ?? '');
  late final TextEditingController _tags = TextEditingController(text: widget.note?.tags ?? '');
  Note? _note;
  bool _editing = false;
  bool _dirty = false;
  bool _busy = false;
  bool _changedAnything = false;

  @override
  void initState() {
    super.initState();
    _note = widget.note;
    _editing = _note == null;
  }

  void _markDirty() {
    if (!_dirty) setState(() => _dirty = true);
  }

  void _toast(String msg) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

  Future<void> _guard(Future<void> Function() fn) async {
    setState(() => _busy = true);
    try {
      await fn();
      _changedAnything = true;
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Network error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    final title = _title.text.trim();
    if (title.isEmpty) { _toast('Title is required'); return; }
    await _guard(() async {
      final cat = _category.text.trim().isEmpty ? null : _category.text.trim();
      final tags = _tags.text.trim().isEmpty ? null : _tags.text.trim();
      final saved = _note == null
          ? await _api.create(title: title, body: _body.text, category: cat, tags: tags)
          : await _api.update(_note!.id, title: title, body: _body.text, category: cat, tags: tags);
      setState(() { _note = saved; _dirty = false; _editing = false; });
      _toast('Saved');
    });
  }

  Future<void> _toggleShare() => _guard(() async {
        final n = _note!;
        final updated = n.isPublic ? await _api.unshare(n.id) : await _api.share(n.id);
        setState(() => _note = updated);
        if (updated.isPublic && updated.shareSlug != null) {
          await Clipboard.setData(ClipboardData(text: _api.shareUrl(updated)));
          _toast('Public link copied');
        } else {
          _toast('Note is private again');
        }
      });

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete note?'),
        content: Text('"${_note!.title}" will be permanently removed from your warehouse.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text('Delete', style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _guard(() async {
      await _api.remove(_note!.id);
      if (mounted) Navigator.of(context).pop(true);
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = MidPaletteScope.of(context);
    final viewing = !_editing && _note != null;
    return PopScope(
      canPop: !_dirty,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final leave = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Discard changes?'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep editing')),
              TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Discard')),
            ],
          ),
        );
        if (leave == true && context.mounted) Navigator.of(context).pop(_changedAnything);
      },
      child: Scaffold(
        appBar: AppBar(
          leading: BackButton(onPressed: () => Navigator.of(context).maybePop(_changedAnything)),
          title: Text(_note?.title.isNotEmpty == true ? _note!.title : 'New note',
              maxLines: 1, overflow: TextOverflow.ellipsis),
          actions: [
            // View / Edit segmented toggle — the desktop's mode switch.
            Container(
              margin: const EdgeInsets.symmetric(vertical: 10),
              padding: const EdgeInsets.all(2),
              decoration: BoxDecoration(
                color: p.surface,
                border: Border.all(color: p.border),
                borderRadius: BorderRadius.circular(MidTokens.rMd),
              ),
              child: Row(children: [
                _seg(p, Icons.visibility_outlined, viewing, _note == null ? null : () => setState(() => _editing = false)),
                _seg(p, Icons.edit_outlined, _editing, () => setState(() => _editing = true)),
              ]),
            ),
            if (_note != null)
              PopupMenuButton<String>(
                iconSize: 20,
                onSelected: (v) {
                  switch (v) {
                    case 'share': _toggleShare();
                    case 'copy':
                      Clipboard.setData(ClipboardData(text: _api.shareUrl(_note!)));
                      _toast('Link copied');
                    case 'delete': _delete();
                  }
                },
                itemBuilder: (context) => [
                  PopupMenuItem(value: 'share', child: Text(_note!.isPublic ? 'Unshare' : 'Share publicly')),
                  if (_note!.isPublic && _note!.shareSlug != null)
                    const PopupMenuItem(value: 'copy', child: Text('Copy public link')),
                  const PopupMenuItem(value: 'delete', child: Text('Delete')),
                ],
              ),
            const SizedBox(width: 4),
          ],
        ),
        floatingActionButton: _editing
            ? FloatingActionButton.extended(
                backgroundColor: p.accent, foregroundColor: p.accentFg,
                onPressed: _busy ? null : _save,
                icon: _busy
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.save_outlined, size: 18),
                label: const Text('Save'),
              )
            : null,
        body: viewing ? _viewer(p) : _editor(p),
      ),
    );
  }

  Widget _seg(MidPalette p, IconData icon, bool active, VoidCallback? onTap) => GestureDetector(
        onTap: onTap,
        child: Container(
          width: 34, height: 24, alignment: Alignment.center,
          decoration: BoxDecoration(
            color: active ? p.bg : Colors.transparent,
            borderRadius: BorderRadius.circular(MidTokens.rXs),
          ),
          child: Icon(icon, size: 15, color: active ? p.fg : p.fgMuted),
        ),
      );

  Widget _viewer(MidPalette p) {
    final n = _note!;
    return Markdown(
      data: n.body,
      padding: const EdgeInsets.all(MidTokens.s5),
      styleSheet: midMarkdownStyle(p),
    );
  }

  Widget _editor(MidPalette p) => Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(MidTokens.s4, MidTokens.s3, MidTokens.s4, 0),
          child: Column(children: [
            TextField(
              controller: _title,
              style: TextStyle(fontSize: MidTokens.fsLg, fontWeight: FontWeight.w600, color: p.fg),
              decoration: const InputDecoration(hintText: 'Note title'),
              onChanged: (_) => _markDirty(),
            ),
            const SizedBox(height: MidTokens.s2),
            Row(children: [
              Expanded(
                child: TextField(
                  controller: _category,
                  decoration: const InputDecoration(hintText: 'Category'),
                  onChanged: (_) => _markDirty(),
                ),
              ),
              const SizedBox(width: MidTokens.s2),
              Expanded(
                child: TextField(
                  controller: _tags,
                  decoration: const InputDecoration(hintText: 'tags, comma, separated'),
                  onChanged: (_) => _markDirty(),
                ),
              ),
            ]),
          ]),
        ),
        const SizedBox(height: MidTokens.s2),
        Divider(color: p.border),
        Expanded(
          child: TextField(
            controller: _body,
            maxLines: null,
            expands: true,
            textAlignVertical: TextAlignVertical.top,
            style: TextStyle(fontFamily: 'monospace', fontSize: 13.5, height: 1.6, color: p.fg),
            decoration: const InputDecoration(
              hintText: 'Write markdown…',
              border: InputBorder.none, enabledBorder: InputBorder.none, focusedBorder: InputBorder.none,
              filled: false,
              contentPadding: EdgeInsets.all(MidTokens.s5),
            ),
            onChanged: (_) => _markDirty(),
          ),
        ),
      ]);
}

/// Markdown reading styles on the shared tokens — mirrors `.mid-md` in the web
/// app and the desktop preview (reading size 17, borders under h1/h2, code on
/// codeBg, striped tables).
MarkdownStyleSheet midMarkdownStyle(MidPalette p) => MarkdownStyleSheet(
      p: TextStyle(fontSize: MidTokens.fsReading, height: 1.65, color: p.fg),
      h1: TextStyle(fontSize: 30, fontWeight: FontWeight.w600, color: p.fg),
      h2: TextStyle(fontSize: 24, fontWeight: FontWeight.w600, color: p.fg),
      h3: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: p.fg),
      h1Padding: const EdgeInsets.only(top: 16, bottom: 4),
      h2Padding: const EdgeInsets.only(top: 14, bottom: 4),
      a: TextStyle(color: p.link),
      code: TextStyle(fontFamily: 'monospace', fontSize: 14, backgroundColor: p.inlineCodeBg, color: p.fg),
      codeblockDecoration: BoxDecoration(
        color: p.codeBg,
        border: Border.all(color: p.border),
        borderRadius: BorderRadius.circular(MidTokens.rMd),
      ),
      codeblockPadding: const EdgeInsets.all(MidTokens.s4),
      blockquoteDecoration: BoxDecoration(
        border: Border(left: BorderSide(color: p.borderStrong, width: 3)),
      ),
      blockquotePadding: const EdgeInsets.only(left: MidTokens.s4, top: 4, bottom: 4),
      horizontalRuleDecoration: BoxDecoration(border: Border(top: BorderSide(color: p.border))),
      tableBorder: TableBorder.all(color: p.border),
      tableHead: TextStyle(fontWeight: FontWeight.w600, color: p.fg),
      tableBody: TextStyle(color: p.fg),
      listBullet: TextStyle(color: p.fg),
    );
