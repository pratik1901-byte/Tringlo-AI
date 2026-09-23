// ============================================================
// Dialo AI — Call Record
// ============================================================
//
// The authoritative record of one dial attempt, as the backend holds it.
//
// Two rules are enforced by this file's shape rather than by discipline:
//
//   1. Every conversation-derived field is nullable and stays null until the
//      provider supplies it. There are no defaults. A call that never connected
//      has no duration, no transcript, no interest level, and the UI shows an
//      em dash for each.
//
//   2. `duration` is whatever the provider reported and nothing else. It is
//      never computed from `requestedAt`, never from a local clock, and there
//      is deliberately no getter here that would let a screen do so. The bug
//      this replaces was exactly that: elapsed time since the request, rendered
//      as though it were call duration.
// ============================================================

import 'call_status.dart';
import 'lead.dart';
import 'parsing.dart';

class TranscriptTurn {
  const TranscriptTurn({required this.speaker, required this.text, this.at});

  final String speaker;
  final String text;
  final DateTime? at;

  factory TranscriptTurn.fromJson(Map<String, dynamic> json) => TranscriptTurn(
        speaker: asString(json['speaker']) ?? asString(json['role']) ?? '',
        text: asString(json['text']) ?? asString(json['content']) ?? '',
        at: asDate(json['at'] ?? json['timestamp']),
      );

  bool get isAgent {
    final s = speaker.toLowerCase();
    return s == 'agent' || s == 'assistant' || s == 'bot';
  }
}

class CallRecord {
  const CallRecord({
    required this.id,
    required this.leadId,
    required this.lead,
    required this.status,
    required this.requestedAt,
    this.startedAt,
    this.connectedAt,
    this.endedAt,
    this.duration,
    this.transcript,
    this.transcriptTurns,
    this.aiSummary,
    this.interestLevel,
    this.interestConfidence,
    this.failureReason,
    this.providerAttemptId,
    this.providerInteractionId,
    this.providerStatus,
    this.connectivityStatus,
    this.completionStatus,
    this.recordingUrl,
    this.callOutcome,
    this.objection,
    this.customerRequirement,
    this.followUpRequired = false,
    this.followUpDate,
    this.followUpTime,
    this.doNotCall = false,
    this.agentName,
    this.origin,
    this.attempts,
  });

  final String id;
  final String leadId;
  final Lead lead;
  final CallStatus status;

  /// When Dialo asked the provider to dial. **Not** when anything connected.
  final DateTime? requestedAt;

  /// Provider-reported start. Null while only the request has been sent.
  final DateTime? startedAt;

  /// Provider-confirmed connection. Null unless the call actually connected.
  final DateTime? connectedAt;

  final DateTime? endedAt;

  /// Seconds, exactly as the provider reported. Null when it reported none.
  final int? duration;

  final String? transcript;
  final List<TranscriptTurn>? transcriptTurns;
  final String? aiSummary;
  final String? interestLevel;
  final double? interestConfidence;
  final String? failureReason;

  final String? providerAttemptId;
  final String? providerInteractionId;
  final String? providerStatus;
  final String? connectivityStatus;
  final String? completionStatus;

  final String? recordingUrl;
  final String? callOutcome;
  final String? objection;
  final String? customerRequirement;

  final bool followUpRequired;
  final String? followUpDate;
  final String? followUpTime;
  final bool doNotCall;

  final String? agentName;
  final String? origin;
  final int? attempts;

  factory CallRecord.fromJson(Map<String, dynamic> json) {
    final turns = asObjectList(json['transcriptTurns']);
    return CallRecord(
      id: asString(json['id']) ?? '',
      leadId: asString(json['leadId']) ?? '',
      lead: Lead.fromJson(asObject(json['lead'])),
      status: CallStatus.parse(asString(json['status'])),
      requestedAt: asDate(json['requestedAt']),
      startedAt: asDate(json['startedAt']),
      connectedAt: asDate(json['connectedAt']),
      endedAt: asDate(json['endedAt']),
      duration: asInt(json['duration']),
      transcript: asString(json['transcript']),
      transcriptTurns:
          turns.isEmpty ? null : turns.map(TranscriptTurn.fromJson).toList(),
      aiSummary: asString(json['aiSummary']),
      interestLevel: asString(json['interestLevel']),
      interestConfidence: asDouble(json['interestConfidence']),
      failureReason: asString(json['failureReason']),
      providerAttemptId: asString(json['providerAttemptId']),
      providerInteractionId: asString(json['providerInteractionId']),
      providerStatus: asString(json['providerStatus']),
      connectivityStatus: asString(json['connectivityStatus']),
      completionStatus: asString(json['completionStatus']),
      recordingUrl: asString(json['recordingUrl']),
      callOutcome: asString(json['callOutcome']),
      objection: asString(json['objection']),
      customerRequirement: asString(json['customerRequirement']),
      followUpRequired: json['followUpRequired'] == true,
      followUpDate: asString(json['followUpDate']),
      followUpTime: asString(json['followUpTime']),
      doNotCall: json['doNotCall'] == true,
      agentName: asString(json['agentName']),
      origin: asString(json['origin']),
      attempts: asInt(json['attempts']),
    );
  }

  bool get isInFlight => status.isInFlight;
  bool get isTerminal => status.isTerminal;

  /// True only when the provider says a conversation happened.
  ///
  /// Everything conversational in the UI is gated on this, so a declined call
  /// cannot render an empty transcript panel as though it had content.
  bool get hasConversation => status.didConnect;

  /// A recording exists only for a call that connected and was recorded.
  bool get hasRecording =>
      status.didConnect &&
      (providerInteractionId != null || recordingUrl != null);

  /// The audio endpoint for this call, or null when there is nothing to play.
  String? get recordingPath => hasRecording ? '/api/calls/$id/recording' : null;
}
