// ============================================================
// Dialo AI — API Failures
// ============================================================
//
// One exception type with a kind, so callers can branch on what went wrong
// rather than parsing a message string.
//
// The distinction the app actually acts on is between *unauthenticated* (sign
// the user out and show the login screen) and everything else (show an error
// and let them retry). §19 of the brief is explicit that nothing may fail
// silently and nothing may report success when the backend failed, so every
// request funnels through here and every failure carries a sentence that is
// safe to show a person.
// ============================================================

enum ApiFailureKind {
  /// No session, or the session expired or was revoked. Sign out.
  unauthenticated,

  /// Authenticated, but not allowed. Rare — most such cases return notFound.
  forbidden,

  notFound,

  /// The request was malformed or rejected by validation.
  badRequest,

  /// A conflicting state, e.g. rescheduling a follow-up that is mid-call.
  conflict,

  rateLimited,

  /// The backend reached but broken, or a dependency (Sarvam) unavailable.
  server,

  /// The backend could not be reached at all.
  network,

  /// The request took too long.
  timeout,

  /// A 200 that did not contain what the contract promises.
  malformedResponse,
}

class ApiException implements Exception {
  ApiException({
    required this.kind,
    required this.message,
    this.code,
    this.statusCode,
    this.retryAfterSeconds,
  });

  final ApiFailureKind kind;

  /// Safe to show to a person as-is.
  final String message;

  /// The backend's machine-readable code, when it sent one.
  final String? code;
  final int? statusCode;
  final int? retryAfterSeconds;

  bool get isAuthFailure => kind == ApiFailureKind.unauthenticated;

  /// True when trying the same request again could plausibly work.
  bool get isRetryable =>
      kind == ApiFailureKind.network ||
      kind == ApiFailureKind.timeout ||
      kind == ApiFailureKind.server ||
      kind == ApiFailureKind.rateLimited;

  factory ApiException.network() => ApiException(
        kind: ApiFailureKind.network,
        message:
            'Could not reach the Dialo server. Check your connection and try again.',
      );

  factory ApiException.timeout() => ApiException(
        kind: ApiFailureKind.timeout,
        message: 'The server took too long to respond. Try again.',
      );

  factory ApiException.malformed(String detail) => ApiException(
        kind: ApiFailureKind.malformedResponse,
        message: 'The server sent an unexpected response.',
        code: detail,
      );

  /// Maps an HTTP status and the backend's error body onto a kind.
  factory ApiException.fromStatus(
    int status, {
    String? code,
    String? message,
    int? retryAfterSeconds,
  }) {
    final kind = switch (status) {
      401 => ApiFailureKind.unauthenticated,
      403 => ApiFailureKind.forbidden,
      404 => ApiFailureKind.notFound,
      409 => ApiFailureKind.conflict,
      423 => ApiFailureKind.forbidden,
      429 => ApiFailureKind.rateLimited,
      >= 400 && < 500 => ApiFailureKind.badRequest,
      _ => ApiFailureKind.server,
    };

    return ApiException(
      kind: kind,
      // The backend writes messages meant for people, so it is preferred over
      // anything invented here.
      message: message?.trim().isNotEmpty == true
          ? message!.trim()
          : _fallbackMessage(kind),
      code: code,
      statusCode: status,
      retryAfterSeconds: retryAfterSeconds,
    );
  }

  static String _fallbackMessage(ApiFailureKind kind) => switch (kind) {
        ApiFailureKind.unauthenticated => 'Your session has ended. Sign in again.',
        ApiFailureKind.forbidden => 'You do not have access to that.',
        ApiFailureKind.notFound => 'That could not be found.',
        ApiFailureKind.conflict => 'That conflicts with the current state.',
        ApiFailureKind.badRequest => 'That request was not accepted.',
        ApiFailureKind.rateLimited => 'Too many requests. Wait a moment.',
        ApiFailureKind.server => 'The Dialo server had a problem with that request.',
        ApiFailureKind.network => 'Could not reach the Dialo server.',
        ApiFailureKind.timeout => 'The server took too long to respond.',
        ApiFailureKind.malformedResponse => 'The server sent an unexpected response.',
      };

  @override
  String toString() =>
      'ApiException(${kind.name}${statusCode != null ? ' $statusCode' : ''}: $message)';
}
