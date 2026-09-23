// ============================================================
// Dialo AI — Overview
// ============================================================
//
// Every figure here is computed by the backend from the same call records the
// Sarvam webhook writes, and fetched in one request. Nothing is counted in the
// client, because two screens counting the same thing separately is how they
// come to disagree.
//
// There are no placeholder numbers. Before the first load there is a loading
// state; with no calls yet there is an empty state that says so. A metric the
// backend has not computed renders as an em dash.
// ============================================================

import 'package:flutter/material.dart';

import '../../core/api_exception.dart';
import '../../models/parsing.dart';
import '../../services/api_client.dart';
import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';
import '../../widgets/states.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  Map<String, dynamic>? _metrics;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final body = await widget.api.get('/api/metrics');
      if (!mounted) return;
      setState(() {
        _metrics = asObject(body['metrics']);
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      // A 401 is already handled by the auth controller, which will move the
      // user to the login screen; showing an error here too would be noise.
      setState(() {
        _error = error.isAuthFailure ? null : error.message;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(label: 'Loading your numbers');

    if (_error != null) {
      return ErrorState(message: _error!, onRetry: _load);
    }

    final metrics = _metrics ?? const <String, dynamic>{};
    final totalCalls = asInt(metrics['totalCalls']) ?? 0;

    if (totalCalls == 0) {
      return EmptyState(
        title: 'No calls yet',
        message:
            'Once Dialo places a call, its result appears here — every figure '
            'comes from what the provider reported, nothing is estimated.',
        icon: Icons.call_outlined,
        action: OutlinedButton(onPressed: _load, child: const Text('Refresh')),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(Space.lg),
        children: [
          LayoutBuilder(
            builder: (context, constraints) {
              // Columns follow available width rather than a device guess, so
              // a narrow desktop window lays out like a tablet, as it should.
              final columns = constraints.maxWidth > 900
                  ? 4
                  : constraints.maxWidth > 560
                      ? 2
                      : 1;

              return GridView.count(
                crossAxisCount: columns,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisSpacing: Space.base,
                mainAxisSpacing: Space.base,
                childAspectRatio: columns == 1 ? 3.4 : 1.9,
                children: [
                  _MetricCard(
                    label: 'Calls placed',
                    value: asInt(metrics['totalCalls']),
                  ),
                  _MetricCard(
                    label: 'Connected',
                    value: asInt(metrics['connectedCalls']),
                    tone: context.colors.positive,
                  ),
                  _MetricCard(
                    label: 'Not picked',
                    value: asInt(metrics['noAnswerCalls']),
                  ),
                  _MetricCard(
                    label: 'Follow-ups due',
                    value: asInt(metrics['pendingFollowUps']),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.label, required this.value, this.tone});

  final String label;

  /// Null means the backend did not report this figure — shown as an em dash,
  /// never as zero, which would read as a real measurement of none.
  final int? value;

  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;

    return Container(
      padding: const EdgeInsets.all(Space.base),
      decoration: BoxDecoration(
        color: colors.card,
        border: Border.all(color: colors.border),
        borderRadius: Radii.cardRadius,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            label,
            style: context.text.bodySmall?.copyWith(color: colors.mutedForeground),
          ),
          const SizedBox(height: Space.sm),
          if (value == null)
            const NoValue()
          else
            Text(
              '$value',
              style: context.text.displaySmall?.copyWith(color: tone),
            ),
        ],
      ),
    );
  }
}
