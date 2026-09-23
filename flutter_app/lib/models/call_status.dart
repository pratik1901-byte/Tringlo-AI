// ============================================================
// Dialo AI — Call Status
// ============================================================
//
// The rule this file exists to enforce: **an accepted outbound request is not a
// connected call.**
//
// Sarvam does not publish ring or answer events for this setup. The only thing
// Dialo knows between "request accepted" and "provider reported an outcome" is
// that it is waiting. So there are exactly two in-flight states, neither of
// which carries a duration, and nothing in the client may advance them — not a
// timer, not an animation, not elapsed time. Only a provider result moves a
// call to a terminal state, and it arrives from the backend.
//
// This mirrors src/lib/types.ts on the server. Unknown values from the wire
// become [CallStatus.unknown] rather than being guessed at, because guessing is
// how a declined call came to be displayed as a conversation in progress.
// ============================================================

enum CallStatus {
  queued,
  scheduled,
  suppressed,

  /// The request has been sent to Sarvam. Nothing has rung yet.
  initiating,

  /// Sarvam accepted the request and Dialo is waiting for the outcome.
  /// This is NOT "ringing" and NOT "connected".
  calling,

  connected,
  noAnswer,
  busy,
  failed,
  cancelled,
  providerError,

  /// A status this build does not recognise. Shown as-is, never interpreted.
  unknown;

  static CallStatus parse(String? raw) => switch (raw?.trim().toLowerCase()) {
        'queued' => CallStatus.queued,
        'scheduled' => CallStatus.scheduled,
        'suppressed' => CallStatus.suppressed,
        'initiating' => CallStatus.initiating,
        'calling' => CallStatus.calling,
        'connected' => CallStatus.connected,
        'no_answer' => CallStatus.noAnswer,
        'busy' => CallStatus.busy,
        'failed' => CallStatus.failed,
        'cancelled' => CallStatus.cancelled,
        'provider_error' => CallStatus.providerError,
        _ => CallStatus.unknown,
      };

  String get wireValue => switch (this) {
        CallStatus.noAnswer => 'no_answer',
        CallStatus.providerError => 'provider_error',
        _ => name,
      };

  /// Waiting on the provider. No duration exists for a call in this state.
  bool get isInFlight =>
      this == CallStatus.initiating || this == CallStatus.calling;

  /// The provider has reported. Nothing will change after this.
  bool get isTerminal => switch (this) {
        CallStatus.connected ||
        CallStatus.noAnswer ||
        CallStatus.busy ||
        CallStatus.failed ||
        CallStatus.cancelled ||
        CallStatus.providerError =>
          true,
        _ => false,
      };

  /// The only state in which a conversation happened, and therefore the only
  /// one that may show a duration, transcript or interest level.
  bool get didConnect => this == CallStatus.connected;

  /// What a person is shown.
  ///
  /// The wording is the server's vocabulary, kept identical so the web and
  /// mobile clients never describe the same call differently. "Declined" is
  /// said only for `busy`, where the provider's own result supports it.
  String get label => switch (this) {
        CallStatus.queued => 'Queued',
        CallStatus.scheduled => 'Scheduled',
        CallStatus.suppressed => 'Do not call',
        CallStatus.initiating => 'Starting',
        CallStatus.calling => 'Calling…',
        CallStatus.connected => 'Connected',
        CallStatus.noAnswer => 'Not picked',
        CallStatus.busy => 'Busy / declined',
        CallStatus.failed => 'Call failed',
        CallStatus.cancelled => 'Cancelled',
        CallStatus.providerError => 'Provider error',
        CallStatus.unknown => 'Unknown',
      };

  /// A sentence explaining the state, for tooltips and detail panels.
  String get description => switch (this) {
        CallStatus.queued => 'Waiting to be dialled.',
        CallStatus.scheduled => 'A callback time is set.',
        CallStatus.suppressed => 'This person asked not to be called.',
        CallStatus.initiating => 'Sending the request to the provider.',
        CallStatus.calling =>
          'Waiting for the provider result. Sarvam does not publish ring or '
              'answer events, so Dialo will not claim the phone is ringing.',
        CallStatus.connected => 'The call connected and a conversation took place.',
        CallStatus.noAnswer => 'Nobody picked up.',
        CallStatus.busy => 'The line was busy, or the person declined the call.',
        CallStatus.failed =>
          'The call never connected. It may have been declined, or the number '
              'may be switched off or unreachable.',
        CallStatus.cancelled => 'The attempt was cancelled.',
        CallStatus.providerError => 'Sarvam rejected or could not place the call.',
        CallStatus.unknown => 'The provider reported a state Dialo does not recognise.',
      };
}

/// How a status should be coloured. Mapped in the widget layer so this file
/// stays free of Flutter imports and can be unit-tested on its own.
enum StatusTone { neutral, progress, positive, warning, negative }

StatusTone toneFor(CallStatus status) => switch (status) {
      CallStatus.connected => StatusTone.positive,
      CallStatus.initiating || CallStatus.calling => StatusTone.progress,
      CallStatus.busy => StatusTone.warning,
      CallStatus.failed || CallStatus.providerError => StatusTone.negative,
      CallStatus.suppressed => StatusTone.negative,
      _ => StatusTone.neutral,
    };
