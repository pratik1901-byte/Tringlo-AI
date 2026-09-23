// ============================================================
// Dialo AI — Client Configuration
// ============================================================
//
// The only thing the client is configured with is where the backend lives.
//
// There is deliberately nothing else here. No Sarvam key, no webhook token, no
// internal secret, no database URL: a Flutter bundle is a file the user can
// unzip, and anything compiled into it is public. Every credential stays on
// the server, which is why the client talks to Dialo's own API and never to
// Sarvam directly.
//
// Set at build time:
//
//   flutter run  --dart-define=DIALO_API_BASE_URL=http://localhost:3000
//   flutter build web --dart-define=DIALO_API_BASE_URL=https://api.example.com
// ============================================================

abstract final class Environment {
  /// Backend origin. Empty means "same origin as this page", which is correct
  /// when Flutter Web is served by the backend itself.
  static const String apiBaseUrl = String.fromEnvironment(
    'DIALO_API_BASE_URL',
    defaultValue: 'http://localhost:3000',
  );

  /// How long a single request may take before it is treated as a failure.
  ///
  /// Placing a call is slower than a read, because the backend is waiting on
  /// Sarvam, so it is given its own longer budget by the caller.
  static const Duration requestTimeout = Duration(seconds: 20);
  static const Duration longRequestTimeout = Duration(seconds: 45);

  /// The origin requests actually go to.
  ///
  /// An empty [apiBaseUrl] means same-origin, which is how the web build is
  /// served in production: the backend hosts the compiled app, so there is no
  /// cross-origin request, no CORS to configure, and the httpOnly session
  /// cookie is sent on its own. `Uri.base` is the page's own URL on web.
  static String get origin {
    if (apiBaseUrl.isNotEmpty) {
      return apiBaseUrl.endsWith('/')
          ? apiBaseUrl.substring(0, apiBaseUrl.length - 1)
          : apiBaseUrl;
    }
    return Uri.base.origin;
  }

  static Uri resolve(String path, [Map<String, String>? query]) {
    final base = origin;
    final normalised = path.startsWith('/') ? path : '/$path';
    return Uri.parse('$base$normalised').replace(
      queryParameters: (query == null || query.isEmpty) ? null : query,
    );
  }
}
