// ============================================================
// Dialo AI — Sign In
// ============================================================
//
// A real sign-in form against a real backend. There are no demo credentials
// and no way to get past this screen without a password the server accepts.
//
// Deliberately plain: a centred card, one column, no illustration and no
// marketing copy. This is the first screen of an internal console, not a
// landing page.
// ============================================================

import 'package:flutter/material.dart';

import '../../auth/auth_controller.dart';
import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.auth});

  final AuthController auth;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _passwordFocus = FocusNode();

  bool _submitting = false;
  bool _obscured = true;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting) return;
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _submitting = true);
    final ok = await widget.auth.signIn(
      email: _email.text,
      password: _password.text,
    );
    if (!mounted) return;
    setState(() => _submitting = false);

    // On success the router redirects; nothing to do here. On failure the
    // controller holds the reason and the form rebuilds to show it.
    if (!ok) _passwordFocus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;

    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(Space.lg),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 380),
            child: AnimatedBuilder(
              animation: widget.auth,
              builder: (context, _) {
                final error = widget.auth.lastError;
                final expired = widget.auth.sessionExpired;

                return Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text('Dialo', style: context.text.displaySmall),
                      const SizedBox(height: Space.xs),
                      Text(
                        'Sign in to continue.',
                        style: context.text.bodyMedium
                            ?.copyWith(color: colors.mutedForeground),
                      ),
                      const SizedBox(height: Space.xl),

                      // Says why they are here, when they did not choose to be.
                      if (expired && error == null) ...[
                        _Notice(
                          message:
                              'Your session ended. Sign in again to continue.',
                          tone: colors.warning,
                        ),
                        const SizedBox(height: Space.base),
                      ],

                      if (error != null) ...[
                        _Notice(message: error, tone: colors.destructive),
                        const SizedBox(height: Space.base),
                      ],

                      TextFormField(
                        controller: _email,
                        autofocus: true,
                        enabled: !_submitting,
                        keyboardType: TextInputType.emailAddress,
                        textInputAction: TextInputAction.next,
                        autofillHints: const [AutofillHints.username],
                        decoration: const InputDecoration(
                          labelText: 'Email',
                          hintText: 'you@company.com',
                        ),
                        validator: (value) {
                          final text = value?.trim() ?? '';
                          if (text.isEmpty) return 'Enter your email address.';
                          if (!text.contains('@') || !text.contains('.')) {
                            return 'That does not look like an email address.';
                          }
                          return null;
                        },
                        onFieldSubmitted: (_) => _passwordFocus.requestFocus(),
                      ),
                      const SizedBox(height: Space.base),

                      TextFormField(
                        controller: _password,
                        focusNode: _passwordFocus,
                        enabled: !_submitting,
                        obscureText: _obscured,
                        textInputAction: TextInputAction.done,
                        autofillHints: const [AutofillHints.password],
                        decoration: InputDecoration(
                          labelText: 'Password',
                          suffixIcon: IconButton(
                            onPressed: () =>
                                setState(() => _obscured = !_obscured),
                            icon: Icon(
                              _obscured
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined,
                              size: 18,
                            ),
                            tooltip: _obscured ? 'Show password' : 'Hide password',
                          ),
                        ),
                        validator: (value) => (value ?? '').isEmpty
                            ? 'Enter your password.'
                            : null,
                        onFieldSubmitted: (_) => _submit(),
                      ),
                      const SizedBox(height: Space.lg),

                      FilledButton(
                        onPressed: _submitting ? null : _submit,
                        child: _submitting
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Text('Sign in'),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.message, required this.tone});

  final String message;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(Space.md),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.08),
        border: Border.all(color: tone.withValues(alpha: 0.35)),
        borderRadius: Radii.controlRadius,
      ),
      child: Text(
        message,
        // Announced to assistive technology, because a failed sign-in that is
        // only visible is a failed sign-in a screen-reader user cannot explain.
        semanticsLabel: message,
        style: context.text.bodySmall,
      ),
    );
  }
}
