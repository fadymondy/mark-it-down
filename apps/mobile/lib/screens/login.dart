// Auth — the desktop "onboarding frame" as a mobile screen: brand glyph,
// centered card, and the same flows as the web SPA (login → optional TOTP
// challenge with recovery fallback, register, emailed-code password reset).
import 'package:flutter/material.dart';
import '../api/auth.dart';
import '../api/client.dart';
import '../app_state.dart';
import '../main.dart';
import '../theme/tokens.dart';
import '../widgets/brand.dart';

enum _Mode { login, challenge, register, resetRequest, resetFinish }

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _auth = AuthApi();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  _Mode _mode = _Mode.login;
  String? _challenge;
  bool _useRecovery = false;
  bool _busy = false;
  String? _error;

  Future<void> _run(Future<void> Function() fn) async {
    setState(() { _busy = true; _error = null; });
    try {
      await fn();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = 'Network error — check your connection and the server URL in Settings.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _done() => AppState.instance.setLoggedIn(true);

  Future<void> _submit() => _run(() async {
        switch (_mode) {
          case _Mode.login:
            _auth.pendingEmail = _email.text.trim();
            final out = await _auth.login(_email.text.trim(), _password.text);
            if (out.mfaRequired) {
              setState(() { _mode = _Mode.challenge; _challenge = out.challenge; _code.clear(); });
            } else {
              _done();
            }
          case _Mode.challenge:
            await _auth.verifyChallenge(_challenge!, _code.text.trim(), recovery: _useRecovery);
            _done();
          case _Mode.register:
            await _auth.register(_email.text.trim(), _password.text);
            _done();
          case _Mode.resetRequest:
            await _auth.requestResetCode(_email.text.trim());
            setState(() { _mode = _Mode.resetFinish; _code.clear(); _password.clear(); });
          case _Mode.resetFinish:
            await _auth.resetPassword(_email.text.trim(), _code.text.trim(), _password.text);
            setState(() { _mode = _Mode.login; _password.clear(); _error = null; });
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Password updated — sign in.')));
            }
        }
      });

  @override
  Widget build(BuildContext context) {
    final p = MidPaletteScope.of(context);
    final (title, subtitle, action) = switch (_mode) {
      _Mode.login => ('Welcome back', 'Sign in to your warehouse', 'Sign in'),
      _Mode.challenge => ('Two-factor check',
          _useRecovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.',
          'Verify'),
      _Mode.register => ('Create your account', 'Your notes, everywhere — in seconds.', 'Create account'),
      _Mode.resetRequest => ('Reset password', "We'll email you a 6-digit reset code.", 'Send code'),
      _Mode.resetFinish => ('Reset password', 'Enter the code and choose a new password.', 'Set new password'),
    };

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(MidTokens.s6),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(MidTokens.s5),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const SizedBox(height: MidTokens.s2),
                      const Center(child: MarkItDownMark(size: 56)),
                      const SizedBox(height: MidTokens.s3),
                      Text(title, textAlign: TextAlign.center,
                          style: TextStyle(fontSize: MidTokens.fsXl, fontWeight: FontWeight.w600, color: p.fg)),
                      const SizedBox(height: MidTokens.s1),
                      Text(subtitle, textAlign: TextAlign.center,
                          style: TextStyle(fontSize: MidTokens.fsSm + 1, color: p.fgMuted)),
                      const SizedBox(height: MidTokens.s5),
                      if (_error != null) ...[
                        Container(
                          padding: const EdgeInsets.all(MidTokens.s3),
                          decoration: BoxDecoration(
                            color: p.surface,
                            border: Border(left: BorderSide(color: p.danger, width: 3)),
                            borderRadius: BorderRadius.circular(MidTokens.rMd),
                          ),
                          child: Text(_error!, style: TextStyle(color: p.danger, fontSize: MidTokens.fsSm + 1)),
                        ),
                        const SizedBox(height: MidTokens.s3),
                      ],
                      if (_mode != _Mode.challenge && _mode != _Mode.resetFinish)
                        TextField(
                          controller: _email,
                          keyboardType: TextInputType.emailAddress,
                          autocorrect: false,
                          decoration: const InputDecoration(labelText: 'Email'),
                        ),
                      if (_mode == _Mode.login || _mode == _Mode.register) ...[
                        const SizedBox(height: MidTokens.s3),
                        TextField(
                          controller: _password,
                          obscureText: true,
                          decoration: const InputDecoration(labelText: 'Password'),
                          onSubmitted: (_) => _submit(),
                        ),
                      ],
                      if (_mode == _Mode.challenge || _mode == _Mode.resetFinish) ...[
                        TextField(
                          controller: _code,
                          keyboardType: _useRecovery ? TextInputType.text : TextInputType.number,
                          autocorrect: false,
                          decoration: InputDecoration(
                            labelText: _mode == _Mode.resetFinish
                                ? 'Reset code'
                                : (_useRecovery ? 'Recovery code' : 'Authentication code'),
                            hintText: _useRecovery ? 'xxxx-xxxx' : '123456',
                          ),
                          onSubmitted: (_) => _submit(),
                        ),
                      ],
                      if (_mode == _Mode.resetFinish) ...[
                        const SizedBox(height: MidTokens.s3),
                        TextField(
                          controller: _password,
                          obscureText: true,
                          decoration: const InputDecoration(labelText: 'New password'),
                          onSubmitted: (_) => _submit(),
                        ),
                      ],
                      const SizedBox(height: MidTokens.s5),
                      FilledButton(
                        onPressed: _busy ? null : _submit,
                        child: _busy
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : Text(action),
                      ),
                      const SizedBox(height: MidTokens.s3),
                      ..._links(p),
                      // One-tap developer login (staging convenience). Always
                      // shown on the login screen; if the server has it
                      // disabled the tap surfaces a clear error instead.
                      if (_mode == _Mode.login) ...[
                        Row(children: [
                          Expanded(child: Divider(color: p.border)),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: MidTokens.s3),
                            child: Text('or', style: TextStyle(color: p.fgMuted, fontSize: MidTokens.fsXs)),
                          ),
                          Expanded(child: Divider(color: p.border)),
                        ]),
                        const SizedBox(height: MidTokens.s2),
                        OutlinedButton.icon(
                          onPressed: _busy ? null : () => _run(() async { await _auth.devLogin(); _done(); }),
                          icon: const Icon(Icons.terminal, size: 16),
                          label: const Text('Login as developer'),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _links(MidPalette p) {
    TextButton link(String label, VoidCallback onTap) =>
        TextButton(onPressed: _busy ? null : onTap, child: Text(label, style: const TextStyle(fontSize: MidTokens.fsSm + 1)));
    switch (_mode) {
      case _Mode.login:
        return [
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            link('Create account', () => setState(() { _mode = _Mode.register; _error = null; })),
            link('Forgot password?', () => setState(() { _mode = _Mode.resetRequest; _error = null; })),
          ]),
        ];
      case _Mode.challenge:
        return [
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            link('Back', () => setState(() { _mode = _Mode.login; _error = null; })),
            link(_useRecovery ? 'Use authenticator code' : 'Use a recovery code',
                () => setState(() { _useRecovery = !_useRecovery; _code.clear(); _error = null; })),
          ]),
        ];
      case _Mode.register:
      case _Mode.resetRequest:
      case _Mode.resetFinish:
        return [Center(child: link('Back to sign in', () => setState(() { _mode = _Mode.login; _error = null; })))];
    }
  }
}
