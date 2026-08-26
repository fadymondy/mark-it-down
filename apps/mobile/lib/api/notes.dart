// Notes warehouse API — identical shapes to web/src/lib/notes.ts.
import 'client.dart';

class Note {
  final String id;
  String title;
  String body;
  String? category;
  String? tags;
  String? shareSlug;
  bool isPublic;
  final DateTime createdAt;
  DateTime updatedAt;

  Note({
    required this.id, required this.title, required this.body,
    this.category, this.tags, this.shareSlug, required this.isPublic,
    required this.createdAt, required this.updatedAt,
  });

  factory Note.fromJson(Map<String, dynamic> j) => Note(
        id: j['id'] as String,
        title: (j['title'] ?? '') as String,
        body: (j['body'] ?? '') as String,
        category: j['category'] as String?,
        tags: j['tags'] as String?,
        shareSlug: j['share_slug'] as String?,
        isPublic: (j['is_public'] ?? false) as bool,
        createdAt: DateTime.parse(j['created_at'] as String),
        updatedAt: DateTime.parse(j['updated_at'] as String),
      );

  List<String> get tagList =>
      (tags ?? '').split(',').map((t) => t.trim()).where((t) => t.isNotEmpty).toList();
}

class NotesApi {
  final _c = ApiClient.instance;

  Future<List<Note>> list({String? query, String? category}) async {
    final params = <String, String>{
      if (query != null && query.isNotEmpty) 'q': query,
      if (category != null && category.isNotEmpty) 'category': category,
    };
    final qs = params.isEmpty ? '' : '?${Uri(queryParameters: params).query}';
    final data = await _c.request('GET', '/api/notes$qs') as List<dynamic>;
    return data.map((e) => Note.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Note> create({required String title, required String body, String? category, String? tags}) async {
    final data = await _c.request('POST', '/api/notes', body: {
      'title': title, 'body': body, 'category': category, 'tags': tags,
    }) as Map<String, dynamic>;
    return Note.fromJson(data);
  }

  Future<Note> update(String id, {required String title, required String body, String? category, String? tags}) async {
    final data = await _c.request('PUT', '/api/notes/$id', body: {
      'title': title, 'body': body, 'category': category, 'tags': tags,
    }) as Map<String, dynamic>;
    return Note.fromJson(data);
  }

  Future<void> remove(String id) => _c.request('DELETE', '/api/notes/$id').then((_) {});

  Future<Note> share(String id) async =>
      Note.fromJson(await _c.request('POST', '/api/notes/$id/share') as Map<String, dynamic>);

  Future<Note> unshare(String id) async =>
      Note.fromJson(await _c.request('DELETE', '/api/notes/$id/share') as Map<String, dynamic>);

  String shareUrl(Note n) => '${_c.server}/s/${n.shareSlug}';
}
