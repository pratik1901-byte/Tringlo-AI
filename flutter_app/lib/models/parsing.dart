// ============================================================
// Dialo AI — JSON Coercion Helpers
// ============================================================
//
// Every model parses through these, so one rule holds everywhere: a value that
// is absent, null, or the wrong type becomes null — never 0, never "", never
// `false`, never `DateTime.now()`.
//
// This matters more here than in most apps. A missing duration that parses to
// 0 would render as "0:00", which reads as a call that connected and lasted no
// time, rather than as a call with no duration because nobody answered. The
// UI's em dash depends on null actually arriving as null.
// ============================================================

String? asString(Object? value) {
  if (value == null) return null;
  if (value is String) return value.trim().isEmpty ? null : value;
  return value.toString();
}

int? asInt(Object? value) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is double) return value.isFinite ? value.round() : null;
  if (value is String) return int.tryParse(value.trim());
  return null;
}

double? asDouble(Object? value) {
  if (value == null) return null;
  if (value is num) return value.isFinite ? value.toDouble() : null;
  if (value is String) return double.tryParse(value.trim());
  return null;
}

bool? asBool(Object? value) {
  if (value == null) return null;
  if (value is bool) return value;
  if (value is String) {
    final lower = value.trim().toLowerCase();
    if (lower == 'true') return true;
    if (lower == 'false') return false;
  }
  return null;
}

/// Parses an ISO-8601 timestamp. An unparseable value is null, not "now":
/// a fabricated timestamp is worse than a missing one.
DateTime? asDate(Object? value) {
  final raw = asString(value);
  if (raw == null) return null;
  return DateTime.tryParse(raw)?.toLocal();
}

List<Map<String, dynamic>> asObjectList(Object? value) {
  if (value is! List) return const [];
  return value.whereType<Map<String, dynamic>>().toList(growable: false);
}

List<String> asStringList(Object? value) {
  if (value is! List) return const [];
  return value
      .map(asString)
      .whereType<String>()
      .toList(growable: false);
}

Map<String, dynamic> asObject(Object? value) =>
    value is Map<String, dynamic> ? value : const {};
