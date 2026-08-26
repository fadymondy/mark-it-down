// Auth flows against the warehouse backend — mirrors the web SPA:
// POST /api/auth/mfa-login → {token,user} or {mfa_required,challenge};
// the challenge completes at /api/auth/mfa/totp/verify (or recovery/verify),
// which returns a session/token usable as a bearer.
import 'client.dart';

class LoginOutcome {
  final bool mfaRequired;
  final String? challenge;
  LoginOutcome.done() : mfaRequired = false, challenge = null;
  LoginOutcome.challenge(this.challenge) : mfaRequired = true;
}

class AuthApi {
  final _c = ApiClient.instance;

  Future<LoginOutcome> login(String email, String password) async {
    final data = await _c.request('POST', '/api/auth/mfa-login', body: {'email': email, 'password': password})
        as Map<String, dynamic>;
    if (data['mfa_required'] == true && data['challenge'] is String) {
      return LoginOutcome.challenge(data['challenge'] as String);
    }
    final user = (data['user'] as Map<String, dynamic>?) ?? {};
    await _c.setSession(
      token: data['token'] as String,
      email: (user['email'] ?? email) as String,
      id: (user['id'] ?? '') as String,
    );
    return LoginOutcome.done();
  }

  /// Complete a 2FA challenge with a TOTP code or a recovery code.
  Future<void> verifyChallenge(String challenge, String code, {bool recovery = false}) async {
    final path = recovery ? '/api/auth/mfa/recovery/verify' : '/api/auth/mfa/totp/verify';
    final data = await _c.request('POST', path, body: {'Challenge': challenge, 'Code': code})
        as Map<String, dynamic>;
    final token = (data['session'] ?? data['token']) as String?;
    if (token == null) throw ApiException(500, 'no session in response');
    await _c.setSession(token: token, email: _pendingEmail ?? '', id: (data['user_id'] ?? '') as String);
  }

  Future<void> register(String email, String password) async {
    final data = await _c.request('POST', '/api/auth/register', body: {'email': email, 'password': password})
        as Map<String, dynamic>;
    final user = (data['user'] as Map<String, dynamic>?) ?? {};
    await _c.setSession(
      token: data['token'] as String,
      email: (user['email'] ?? email) as String,
      id: (user['id'] ?? '') as String,
    );
  }

  Future<void> requestResetCode(String email) =>
      _c.request('POST', '/api/auth/otp', body: {'email': email, 'purpose': 'reset'}).then((_) {});

  Future<void> resetPassword(String email, String code, String newPassword) => _c
      .request('POST', '/api/auth/reset-password', body: {'email': email, 'code': code, 'new_password': newPassword})
      .then((_) {});

  /// One-tap developer login — hits the app's bearer variant
  /// (POST /api/auth/dev/token) and stores the returned admin token.
  Future<void> devLogin() async {
    final data = await _c.request('POST', '/api/auth/dev/token',
        headers: {'X-Dev-Login-Secret': kDevLoginSecret}) as Map<String, dynamic>;
    final user = (data['user'] as Map<String, dynamic>?) ?? {};
    await _c.setSession(
      token: data['token'] as String,
      email: (user['email'] ?? 'developer') as String,
      id: (user['id'] ?? '') as String,
    );
  }

  /// Confirm the stored bearer still works; returns the fresh identity or null.
  Future<Map<String, dynamic>?> me() async {
    try {
      final data = await _c.request('GET', '/api/auth/me');
      return data as Map<String, dynamic>?;
    } on ApiException catch (e) {
      if (e.status == 401) return null;
      rethrow;
    }
  }

  String? _pendingEmail;
  set pendingEmail(String v) => _pendingEmail = v;
}
