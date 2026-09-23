// ============================================================
// Dialo AI — API Client
// ============================================================
//
// Every request the app makes goes through here, which is what makes a few
// guarantees possible in one place:
//
//   - the session travels correctly on each platform (bearer header on mobile,
//     httpOnly cookie on web);
//   - every non-2xx becomes a typed ApiException with a message fit to show;
//   - a 401 is reported once to whoever owns sign-in state, so an expired
//     session logs the user out everywhere rather than leaving half the screens
//     retrying;
//   - nothing ever returns a partially-parsed body as if it were data.
//
// It talks only to Dialo's backend. It has no provider credentials and no
// knowledge of Sarvam, the database or the scheduler.
// ============================================================

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/environment.dart';
import '../core/api_exception.dart';
import '../auth/token_storage.dart';

typedef UnauthorizedCallback = void Function();

class ApiClient {
  ApiClient({
    http.Client? httpClient,
    TokenStorage? tokenStorage,
  })  : _http = httpClient ?? http.Client(),
        _tokens = tokenStorage ?? TokenStorage.forPlatform();

  final http.Client _http;
  final TokenStorage _tokens;

  /// Called when the server rejects the session. Set by the auth controller.
  UnauthorizedCallback? onUnauthorized;

  /// Held in memory for the life of the run so each request does not hit
  /// platform secure storage. Secure storage remains the durable copy.
  String? _cachedToken;

  Future<void> setToken(String? token) async {
    _cachedToken = token;
    if (token == null) {
      await _tokens.clear();
    } else if (_tokens.usesBearerToken) {
      await _tokens.write(token);
    }
  }

  /// Restores a token saved by a previous run. Web has none by design.
  Future<String?> restoreToken() async {
    _cachedToken ??= await _tokens.read();
    return _cachedToken;
  }

  Future<Map<String, String>> _headers({bool json = true}) async {
    final headers = <String, String>{
      if (json) 'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (_tokens.usesBearerToken) {
      final token = _cachedToken ?? await _tokens.read();
      if (token != null) {
        headers['Authorization'] = 'Bearer $token';
        // Lets the backend record which kind of client the session belongs to.
        headers['x-dialo-client'] = 'mobile';
      }
    }
    return headers;
  }

  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, String>? query,
    Duration? timeout,
  }) =>
      _send(
        () async => _http.get(
          Environment.resolve(path, query),
          headers: await _headers(),
        ),
        timeout: timeout,
      );

  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    Duration? timeout,
  }) =>
      _send(
        () async => _http.post(
          Environment.resolve(path),
          headers: await _headers(),
          body: jsonEncode(body ?? const {}),
        ),
        timeout: timeout,
      );

  Future<Map<String, dynamic>> patch(
    String path, {
    Object? body,
    Duration? timeout,
  }) =>
      _send(
        () async => _http.patch(
          Environment.resolve(path),
          headers: await _headers(),
          body: jsonEncode(body ?? const {}),
        ),
        timeout: timeout,
      );

  Future<Map<String, dynamic>> delete(String path, {Duration? timeout}) =>
      _send(
        () async => _http.delete(
          Environment.resolve(path),
          headers: await _headers(),
        ),
        timeout: timeout,
      );

  /// Runs one request and turns every possible outcome into data or a typed
  /// exception — never an unhandled error and never a silent empty result.
  Future<Map<String, dynamic>> _send(
    Future<http.Response> Function() request, {
    Duration? timeout,
  }) async {
    http.Response response;
    try {
      response = await request().timeout(timeout ?? Environment.requestTimeout);
    } on TimeoutException {
      throw ApiException.timeout();
    } catch (_) {
      // Socket errors, DNS failures, a backend that is not running, CORS on
      // web: from the app's point of view these are all "cannot reach Dialo".
      throw ApiException.network();
    }

    Map<String, dynamic>? body;
    if (response.body.isNotEmpty) {
      try {
        final decoded = jsonDecode(response.body);
        if (decoded is Map<String, dynamic>) body = decoded;
      } catch (_) {
        body = null;
      }
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (body == null) {
        throw ApiException.malformed('Expected a JSON object from the server.');
      }
      return body;
    }

    final error = body?['error'];
    final code = error is Map ? error['code'] as String? : null;
    final message = error is Map
        ? error['message'] as String?
        : (body?['error'] is String ? body!['error'] as String : null);
    final retryAfter = error is Map ? error['retryAfter'] : null;

    final exception = ApiException.fromStatus(
      response.statusCode,
      code: code,
      message: message,
      retryAfterSeconds: retryAfter is int ? retryAfter : null,
    );

    // Announced before throwing so sign-in state is corrected even if the
    // caller chooses to swallow the error.
    if (exception.isAuthFailure) onUnauthorized?.call();

    throw exception;
  }

  /// Fetches raw bytes — used for call recordings, which are audio, not JSON.
  Future<({List<int> bytes, String contentType})> getBytes(
    String path, {
    Duration? timeout,
  }) async {
    http.Response response;
    try {
      response = await _http
          .get(Environment.resolve(path), headers: await _headers(json: false))
          .timeout(timeout ?? Environment.longRequestTimeout);
    } on TimeoutException {
      throw ApiException.timeout();
    } catch (_) {
      throw ApiException.network();
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final exception = ApiException.fromStatus(response.statusCode);
      if (exception.isAuthFailure) onUnauthorized?.call();
      throw exception;
    }

    return (
      bytes: response.bodyBytes,
      contentType: response.headers['content-type'] ?? 'application/octet-stream',
    );
  }

  void dispose() => _http.close();
}
