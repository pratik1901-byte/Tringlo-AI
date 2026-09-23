// ============================================================
// Dialo AI — Loading, Empty and Error States
// ============================================================
//
// Three states every data screen needs, written once so they read the same
// everywhere. §18 and §19 of the brief require all three to be explicit: a
// screen must never sit blank while loading, never show an empty table as
// though it were an answer, and never fail silently.
//
// The empty state says what would be here and how it gets here, rather than
// apologising. The error state always offers the retry.
// ============================================================

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/tokens.dart';

/// Quiet, centred progress. Deliberately unadorned: a loading state that
/// entertains is a loading state that draws attention away from the content
/// arriving behind it.
class LoadingState extends StatelessWidget {
  const LoadingState({super.key, this.label});

  final String? label;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: context.colors.mutedForeground,
            ),
          ),
          if (label != null) ...[
            const SizedBox(height: Space.md),
            Text(
              label!,
              style: context.text.bodySmall
                  ?.copyWith(color: context.colors.mutedForeground),
            ),
          ],
        ],
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.title,
    required this.message,
    this.icon,
    this.action,
  });

  final String title;
  final String message;
  final IconData? icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 380),
        child: Padding(
          padding: const EdgeInsets.all(Space.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 22, color: colors.mutedForeground),
                const SizedBox(height: Space.md),
              ],
              Text(
                title,
                style: context.text.titleMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: Space.sm),
              Text(
                message,
                style: context.text.bodySmall
                    ?.copyWith(color: colors.mutedForeground),
                textAlign: TextAlign.center,
              ),
              if (action != null) ...[
                const SizedBox(height: Space.lg),
                action!,
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Failure, stated plainly, with the way out.
class ErrorState extends StatelessWidget {
  const ErrorState({
    super.key,
    required this.message,
    this.onRetry,
    this.compact = false,
  });

  final String message;
  final VoidCallback? onRetry;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;

    final content = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment:
          compact ? CrossAxisAlignment.start : CrossAxisAlignment.center,
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.error_outline, size: 18, color: colors.destructive),
            const SizedBox(width: Space.sm),
            Flexible(
              child: Text(
                message,
                style: context.text.bodySmall,
                textAlign: compact ? TextAlign.start : TextAlign.center,
              ),
            ),
          ],
        ),
        if (onRetry != null) ...[
          const SizedBox(height: Space.md),
          OutlinedButton(onPressed: onRetry, child: const Text('Try again')),
        ],
      ],
    );

    if (compact) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(Space.md),
        decoration: BoxDecoration(
          color: colors.card,
          border: Border.all(color: colors.destructive.withValues(alpha: 0.4)),
          borderRadius: Radii.cardRadius,
        ),
        child: content,
      );
    }

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 380),
        child: Padding(
          padding: const EdgeInsets.all(Space.xl),
          child: content,
        ),
      ),
    );
  }
}

/// The em dash used wherever a value is genuinely unknown.
///
/// Never a zero, never "N/A", never a guess. A call that did not connect has no
/// duration, and this is what that looks like.
class NoValue extends StatelessWidget {
  const NoValue({super.key});

  @override
  Widget build(BuildContext context) => Text(
        '—',
        style: TextStyle(color: context.colors.mutedForeground),
        semanticsLabel: 'No value',
      );
}
