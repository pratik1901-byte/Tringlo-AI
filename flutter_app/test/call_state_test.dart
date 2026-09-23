// Tests for the call-state rule.
//
// The bug these exist to prevent: a call that was requested — or declined —
// being displayed as a conversation in progress, with a running duration.
//
// Every assertion here is about what the client is allowed to conclude from
// provider data. If one of these fails, the UI is inventing state.

import 'package:flutter_test/flutter_test.dart';

import 'package:dialo_app/models/call_record.dart';
import 'package:dialo_app/models/call_status.dart';

/// A record shaped the way the backend writes one that has only been requested:
/// accepted by the provider, nothing reported back yet.
Map<String, dynamic> requestedCall() => {
      'id': 'call_1',
      'leadId': 'lead_1',
      'lead': {'id': 'lead_1', 'name': 'Test Person', 'phone': '9000000000'},
      'status': 'calling',
      'requestedAt': '2026-09-23T10:00:00.000Z',
      'startedAt': null,
      'connectedAt': null,
      'endedAt': null,
      'duration': null,
      'transcript': null,
      'aiSummary': null,
      'interestLevel': null,
      'providerStatus': 'accepted',
    };

void main() {
  group('An accepted outbound request is not a connected call', () {
    test('a requested call is in flight, not connected', () {
      final call = CallRecord.fromJson(requestedCall());

      expect(call.status, CallStatus.calling);
      expect(call.isInFlight, isTrue);
      expect(call.isTerminal, isFalse);
      expect(call.status.didConnect, isFalse);
      expect(call.hasConversation, isFalse);
    });

    test('a requested call carries no duration and no connection time', () {
      final call = CallRecord.fromJson(requestedCall());

      // These being null is what stops a screen rendering "0:00" as though the
      // call had connected and lasted no time.
      expect(call.duration, isNull);
      expect(call.connectedAt, isNull);
      expect(call.startedAt, isNull);
    });

    test('requestedAt is not treated as a start time', () {
      final call = CallRecord.fromJson(requestedCall());

      expect(call.requestedAt, isNotNull);
      // The request timestamp exists, but nothing derives a duration from it.
      expect(call.startedAt, isNull);
      expect(call.duration, isNull);
    });

    test('the in-flight label never claims the phone is ringing', () {
      expect(CallStatus.calling.label, 'Calling…');
      expect(CallStatus.calling.label.toLowerCase(), isNot(contains('progress')));
      expect(CallStatus.calling.label.toLowerCase(), isNot(contains('connected')));
      expect(CallStatus.calling.label.toLowerCase(), isNot(contains('ringing')));
      expect(CallStatus.calling.description, contains('Waiting for the provider'));
    });

    test('no conversation fields are invented while waiting', () {
      final call = CallRecord.fromJson(requestedCall());

      expect(call.transcript, isNull);
      expect(call.aiSummary, isNull);
      expect(call.interestLevel, isNull);
      expect(call.hasRecording, isFalse);
      expect(call.recordingPath, isNull);
    });
  });

  group('Provider outcomes map to the agreed wording', () {
    test('no_answer reads as Not picked', () {
      final status = CallStatus.parse('no_answer');
      expect(status, CallStatus.noAnswer);
      expect(status.label, 'Not picked');
      expect(status.isTerminal, isTrue);
      expect(status.didConnect, isFalse);
    });

    test('busy is the only state allowed to say declined', () {
      expect(CallStatus.busy.label, 'Busy / declined');

      // Every other terminal state must avoid the word, because nothing else
      // carries provider evidence that the person declined.
      for (final status in [
        CallStatus.noAnswer,
        CallStatus.failed,
        CallStatus.cancelled,
        CallStatus.providerError,
      ]) {
        expect(
          status.label.toLowerCase(),
          isNot(contains('declined')),
          reason: '${status.name} must not claim the call was declined',
        );
      }
    });

    test('failed reads as Call failed and does not assert a reason', () {
      final status = CallStatus.parse('failed');
      expect(status.label, 'Call failed');
      expect(status.didConnect, isFalse);
      // Sarvam reports these with no reason, so the description stays hedged.
      expect(status.description, contains('may'));
    });

    test('connected is the only status that permits a conversation', () {
      for (final status in CallStatus.values) {
        if (status == CallStatus.connected) {
          expect(status.didConnect, isTrue);
        } else {
          expect(
            status.didConnect,
            isFalse,
            reason: '${status.name} must not count as connected',
          );
        }
      }
    });

    test('an unrecognised provider status is not guessed at', () {
      final status = CallStatus.parse('some_future_state');
      expect(status, CallStatus.unknown);
      expect(status.didConnect, isFalse);
      expect(status.isTerminal, isFalse);
      expect(status.isInFlight, isFalse);
    });

    test('a null status does not become a connected call', () {
      expect(CallStatus.parse(null), CallStatus.unknown);
      expect(CallStatus.parse(''), CallStatus.unknown);
    });
  });

  group('A connected call reports the provider duration', () {
    test('duration comes from the provider, unchanged', () {
      final call = CallRecord.fromJson({
        ...requestedCall(),
        'status': 'connected',
        'startedAt': '2026-09-23T10:00:05.000Z',
        'connectedAt': '2026-09-23T10:00:05.000Z',
        'endedAt': '2026-09-23T10:01:12.000Z',
        'duration': 67,
        'providerInteractionId': '20260923/abc:1',
      });

      expect(call.status, CallStatus.connected);
      expect(call.hasConversation, isTrue);
      expect(call.duration, 67);
      expect(call.connectedAt, isNotNull);
      expect(call.hasRecording, isTrue);
      expect(call.recordingPath, '/api/calls/call_1/recording');
    });

    test('a declined call offers no recording even with an interaction id', () {
      final call = CallRecord.fromJson({
        ...requestedCall(),
        'status': 'busy',
        'providerInteractionId': '20260923/abc:1',
      });

      expect(call.hasRecording, isFalse);
      expect(call.recordingPath, isNull);
    });
  });

  group('Missing values stay missing', () {
    test('a duration of null does not become zero', () {
      final call = CallRecord.fromJson({...requestedCall(), 'duration': null});
      expect(call.duration, isNull);
      expect(call.duration, isNot(0));
    });

    test('empty strings parse as absent rather than as content', () {
      final call = CallRecord.fromJson({
        ...requestedCall(),
        'transcript': '   ',
        'aiSummary': '',
      });
      expect(call.transcript, isNull);
      expect(call.aiSummary, isNull);
    });

    test('a malformed timestamp is null, not now', () {
      final call = CallRecord.fromJson({
        ...requestedCall(),
        'endedAt': 'not-a-date',
      });
      expect(call.endedAt, isNull);
    });
  });
}
