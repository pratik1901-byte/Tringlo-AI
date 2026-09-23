// ============================================================
// Dialo AI — Session Token Storage
// ============================================================
//
// Where the session token lives differs by platform, because the threat differs
// by platform:
//
//   - Android and iOS keep it in platform secure storage — EncryptedShared-
//     Preferences and the Keychain — so another app on the device, or someone
//     reading a backup, cannot lift it.
//
//   - On the web the token is deliberately NOT stored at all. The browser
//     already holds an httpOnly session cookie that the backend set, which
//     JavaScript cannot read and an XSS bug therefore cannot steal. Copying the
//     same session into localStorage would hand that protection back. The web
//     build stays signed in across restarts through the cookie.
//
// This is the reason `read` returns null on web and the API client sends
// credentials instead: it is not an omission.
// ============================================================

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract interface class TokenStorage {
  Future<String?> read();
  Future<void> write(String token);
  Future<void> clear();

  /// True when this platform keeps a bearer token the client must send itself.
  bool get usesBearerToken;

  factory TokenStorage.forPlatform() =>
      kIsWeb ? const CookieSessionStorage() : SecureTokenStorage();
}

/// Mobile and desktop: the token is ours to keep, so keep it properly.
class SecureTokenStorage implements TokenStorage {
  SecureTokenStorage({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              // Defaults are already AES-GCM with RSA-OAEP key wrapping backed
              // by the Android keystore; there is no weaker mode to opt out of.
              aOptions: AndroidOptions(),
              // Readable after the device has been unlocked once, so a
              // scheduled restart does not sign the user out, but the token is
              // not available while the phone has never been unlocked.
              iOptions: IOSOptions(
                accessibility: KeychainAccessibility.first_unlock,
              ),
            );

  static const _key = 'dialo_session_token';
  final FlutterSecureStorage _storage;

  @override
  bool get usesBearerToken => true;

  @override
  Future<String?> read() async {
    try {
      final value = await _storage.read(key: _key);
      return (value == null || value.isEmpty) ? null : value;
    } catch (_) {
      // A keystore that refuses to open must read as "not signed in", not as a
      // crash on launch.
      return null;
    }
  }

  @override
  Future<void> write(String token) async {
    try {
      await _storage.write(key: _key, value: token);
    } catch (_) {
      // The session still works for this run; it just will not survive a
      // restart. Failing the login over it would be worse.
    }
  }

  @override
  Future<void> clear() async {
    try {
      await _storage.delete(key: _key);
    } catch (_) {
      // Nothing to do: the server-side session is deleted regardless, which is
      // what actually ends the session.
    }
  }
}

/// Web: the httpOnly cookie is the session, so there is nothing to hold.
class CookieSessionStorage implements TokenStorage {
  const CookieSessionStorage();

  @override
  bool get usesBearerToken => false;

  @override
  Future<String?> read() async => null;

  @override
  Future<void> write(String token) async {}

  @override
  Future<void> clear() async {}
}
