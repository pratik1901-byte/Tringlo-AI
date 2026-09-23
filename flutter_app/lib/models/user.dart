// ============================================================
// Dialo AI — Signed-in User
// ============================================================
//
// Exactly what /api/auth/me returns, which is exactly what the client is
// allowed to know. There is no password field and no hash field, because the
// server never sends either.
// ============================================================

import 'parsing.dart';

class AppUser {
  const AppUser({
    required this.id,
    required this.email,
    required this.name,
    required this.role,
    required this.tenantId,
    required this.tenantName,
  });

  final String id;
  final String email;
  final String name;
  final String role;

  /// The business this account belongs to. Every list the app shows is scoped
  /// to it by the server; the client never sends it as a filter, because a
  /// client-supplied tenant id would be a client-controlled access decision.
  final String tenantId;
  final String tenantName;

  bool get isOwner => role == 'owner';

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        id: asString(json['id']) ?? '',
        email: asString(json['email']) ?? '',
        name: asString(json['name']) ?? '',
        role: asString(json['role']) ?? 'member',
        tenantId: asString(json['tenantId']) ?? '',
        tenantName: asString(json['tenantName']) ?? '',
      );

  /// Initials for the account menu. Falls back to the email so there is always
  /// something, without inventing a name.
  String get initials {
    final source = name.trim().isNotEmpty ? name.trim() : email.trim();
    if (source.isEmpty) return '?';
    final parts = source.split(RegExp(r'[\s@._-]+')).where((p) => p.isNotEmpty);
    if (parts.isEmpty) return source[0].toUpperCase();
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.elementAt(1)[0]).toUpperCase();
  }
}
