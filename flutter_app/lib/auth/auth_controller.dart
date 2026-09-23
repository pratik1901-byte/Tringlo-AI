// ============================================================
// Dialo AI — Authentication State
// ============================================================
//
// Owns the answer to "is someone signed in, and who?", and is the only place
// that answer changes.
//
// The controller never trusts its own stored copy of the user on startup. It
// asks the server, because a session can be revoked, expire, or belong to a
// deleted account while the app was closed — and only the server knows. That
// call is what makes "still signed in after a restart" true rather than
// merely displayed.
// ============================================================

import 'package:flutter/foundation.dart';

import '../core/api_exception.dart';
import '../models/user.dart';
import '../services/api_client.dart';

enum AuthStatus {
  /// Checking with the server. The UI shows a loading state, not a login form:
  /// flashing the login screen at an already-signed-in user is a bug.
  checking,
  signedIn,
  signedOut,
}

class AuthController extends ChangeNotifier {
  AuthController(this._api) {
    // A 401 from anywhere in the app lands here, so one expired session signs
    // the user out once rather than each screen discovering it separately.
    _api.onUnauthorized = _handleUnauthorized;
  }

  final ApiClient _api;

  AuthStatus _status = AuthStatus.checking;
  AppUser? _user;
  String? _lastError;

  /// Set when a session ended by itself rather than by the user choosing to
  /// sign out, so the login screen can say why they are looking at it.
  bool _expired = false;

  AuthStatus get status => _status;
  AppUser? get user => _user;
  String? get lastError => _lastError;
  bool get sessionExpired => _expired;
  bool get isSignedIn => _status == AuthStatus.signedIn;

  /// Resolves the session on launch.
  ///
  /// On mobile this restores the saved bearer token first; on web there is
  /// nothing to restore because the cookie travels on its own.
  Future<void> restore() async {
    await _api.restoreToken();
    try {
      final body = await _api.get('/api/auth/me');
      _user = AppUser.fromJson(body['user'] as Map<String, dynamic>? ?? const {});
      _status = AuthStatus.signedIn;
      _expired = false;
    } on ApiException catch (error) {
      // Not being signed in is a normal outcome here, not a failure worth
      // reporting. A network problem is worth reporting, so it is kept.
      _user = null;
      _status = AuthStatus.signedOut;
      _lastError = error.isAuthFailure ? null : error.message;
      if (error.isAuthFailure) await _api.setToken(null);
    }
    notifyListeners();
  }

  /// Signs in. Returns true on success; on failure [lastError] explains why.
  Future<bool> signIn({required String email, required String password}) async {
    _lastError = null;
    notifyListeners();

    try {
      final body = await _api.post('/api/auth/login', body: {
        'email': email.trim(),
        'password': password,
      });

      // Web receives an httpOnly cookie and ignores the token field; mobile
      // stores the token. setToken handles both.
      final token = body['token'];
      await _api.setToken(token is String ? token : null);

      _user = AppUser.fromJson(body['user'] as Map<String, dynamic>? ?? const {});
      _status = AuthStatus.signedIn;
      _expired = false;
      notifyListeners();
      return true;
    } on ApiException catch (error) {
      _lastError = error.message;
      _status = AuthStatus.signedOut;
      notifyListeners();
      return false;
    }
  }

  /// Signs out, ending the session on the server as well as in the app.
  Future<void> signOut() async {
    try {
      await _api.post('/api/auth/logout');
    } on ApiException {
      // The local session is cleared regardless. A user who asked to sign out
      // must end up signed out even if the network refused.
    }
    await _api.setToken(null);
    _user = null;
    _status = AuthStatus.signedOut;
    _expired = false;
    _lastError = null;
    notifyListeners();
  }

  /// Called by the API client when the server rejects the session mid-use.
  void _handleUnauthorized() {
    if (_status == AuthStatus.signedOut) return;
    _user = null;
    _status = AuthStatus.signedOut;
    _expired = true;
    // Fire-and-forget: the token is already worthless, and awaiting here would
    // mean blocking whichever request discovered the problem.
    _api.setToken(null);
    notifyListeners();
  }

  void clearError() {
    if (_lastError == null) return;
    _lastError = null;
    notifyListeners();
  }
}
