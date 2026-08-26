// Warehouse API client — talks to the same ToGo backend as the web, desktop,
// and Chrome apps (default https://markitdown.fadymondy.com, changeable in
// Settings). Auth is a bearer token from POST /api/auth/mfa-login (JWT), kept
// in secure storage; every request sends Authorization: Bearer <token>.
import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

const kDefaultServer = 'https://markitdown.fadymondy.com';

// Shared secret for the one-tap developer login (POST /api/auth/dev/token) —
// matches DEV_LOGIN_SECRET on the staging server. Test convenience only; the
// endpoint is not mounted when APP_ENV=production. Override at build time with
// --dart-define=MID_DEV_LOGIN_SECRET=… .
const kDevLoginSecret = String.fromEnvironment(
  'MID_DEV_LOGIN_SECRET',
  defaultValue: 'mid_dev_5d469556222628024a6db153c97c83e0',
);

class ApiException implements Exception {
  final int status;
  final String message;
  ApiException(this.status, this.message);
  @override
  String toString() => message;
}

class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  static const _storage = FlutterSecureStorage();
  String _server = kDefaultServer;
  String? _token;
  String? userEmail;
  String? userId;
  bool get isLoggedIn => _token != null;
  String get server => _server;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _server = prefs.getString('mid-server') ?? kDefaultServer;
    userEmail = prefs.getString('mid-user-email');
    userId = prefs.getString('mid-user-id');
    _token = await _storage.read(key: 'mid-token');
  }

  Future<void> setServer(String url) async {
    _server = url.replaceAll(RegExp(r'/+$'), '');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('mid-server', _server);
  }

  Future<void> setSession({required String token, required String email, required String id}) async {
    _token = token;
    userEmail = email;
    userId = id;
    await _storage.write(key: 'mid-token', value: token);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('mid-user-email', email);
    await prefs.setString('mid-user-id', id);
  }

  Future<void> logout() async {
    _token = null;
    userEmail = null;
    userId = null;
    await _storage.delete(key: 'mid-token');
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('mid-user-email');
    await prefs.remove('mid-user-id');
  }

  Map<String, String> _headers({bool json = true, Map<String, String>? extra}) => {
        if (json) 'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
        ...?extra,
      };

  Future<dynamic> request(String method, String path, {Object? body, Map<String, String>? headers}) async {
    final uri = Uri.parse('$_server$path');
    late http.Response res;
    final encoded = body == null ? null : jsonEncode(body);
    switch (method) {
      case 'GET':
        res = await http.get(uri, headers: _headers(json: false));
      case 'POST':
        res = await http.post(uri, headers: _headers(extra: headers), body: encoded);
      case 'PUT':
        res = await http.put(uri, headers: _headers(), body: encoded);
      case 'DELETE':
        res = await http.delete(uri, headers: _headers(), body: encoded);
      default:
        throw ArgumentError(method);
    }
    if (res.statusCode == 204) return null;
    dynamic data;
    try {
      data = jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      data = null;
    }
    if (res.statusCode >= 400) {
      final msg = (data is Map ? (data['error'] ?? data['detail'] ?? data['message']) : null)?.toString() ??
          'Request failed (${res.statusCode})';
      throw ApiException(res.statusCode, msg);
    }
    return data;
  }
}
