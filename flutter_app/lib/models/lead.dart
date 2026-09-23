// ============================================================
// Dialo AI — Lead
// ============================================================
//
// One person to call. Mirrors the `Lead` contract the API returns.
//
// Parsing is defensive on purpose: a field the backend has not filled in is
// null here and renders as an em dash, never as a plausible-looking default.
// ============================================================

import 'call_status.dart';
import 'parsing.dart';

class Lead {
  const Lead({
    required this.id,
    required this.name,
    required this.phone,
    required this.status,
    required this.suppressed,
    this.email,
    this.company,
    this.notes,
    this.campaign,
    this.callingDate,
    this.callingTime,
    this.timezone,
    this.createdAt,
    this.suppressedReason,
    this.suppressedAt,
  });

  final String id;
  final String name;
  final String phone;
  final CallStatus status;

  /// The person asked not to be called. Dialo must never dial them again.
  final bool suppressed;

  final String? email;
  final String? company;
  final String? notes;
  final String? campaign;
  final String? callingDate;
  final String? callingTime;
  final String? timezone;
  final DateTime? createdAt;
  final String? suppressedReason;
  final DateTime? suppressedAt;

  factory Lead.fromJson(Map<String, dynamic> json) => Lead(
        id: asString(json['id']) ?? '',
        // A lead with no name is shown by number rather than as "Unknown",
        // which would read as data Dialo holds and does not.
        name: asString(json['name']) ?? '',
        phone: asString(json['phone']) ?? '',
        status: CallStatus.parse(asString(json['status'])),
        suppressed: json['suppressed'] == true,
        email: asString(json['email']),
        company: asString(json['company']),
        notes: asString(json['notes']),
        campaign: asString(json['campaign']),
        callingDate: asString(json['callingDate']),
        callingTime: asString(json['callingTime']),
        timezone: asString(json['timezone']),
        createdAt: asDate(json['createdAt']),
        suppressedReason: asString(json['suppressedReason']),
        suppressedAt: asDate(json['suppressedAt']),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'phone': phone,
        if (email != null) 'email': email,
        if (company != null) 'company': company,
        if (notes != null) 'notes': notes,
        if (campaign != null) 'campaign': campaign,
        if (callingDate != null) 'callingDate': callingDate,
        if (callingTime != null) 'callingTime': callingTime,
        if (timezone != null) 'timezone': timezone,
      };

  /// What to show where a name is expected, without inventing one.
  String get displayName => name.trim().isNotEmpty ? name.trim() : phone;
}
