// ============================================================
// Dialo AI — Design Tokens
// ============================================================
//
// The same palette, radii and spacing the web client uses, so the Flutter app
// is the same product rather than a lookalike. Values are copied from
// src/app/globals.css; if that file changes, change this one with it.
//
// The palette is near-neutral stone with a single indigo accent. Colour is
// reserved for state that means something — a connected call, an overdue
// callback — so it stays informative rather than decorative. There are no
// gradients: at this density a flat surface with a considered border reads as
// more precise.
// ============================================================

import 'package:flutter/material.dart';

/// One colour set. Two instances exist: [DialoColors.light] and `.dark`.
@immutable
class DialoColors {
  const DialoColors({
    required this.background,
    required this.foreground,
    required this.card,
    required this.cardForeground,
    required this.primary,
    required this.primaryForeground,
    required this.secondary,
    required this.secondaryForeground,
    required this.muted,
    required this.mutedForeground,
    required this.accent,
    required this.accentForeground,
    required this.destructive,
    required this.destructiveForeground,
    required this.border,
    required this.input,
    required this.ring,
    required this.positive,
    required this.warning,
    required this.chart,
  });

  final Color background;
  final Color foreground;
  final Color card;
  final Color cardForeground;
  final Color primary;
  final Color primaryForeground;
  final Color secondary;
  final Color secondaryForeground;
  final Color muted;

  /// Secondary text. Everything that is context rather than content.
  final Color mutedForeground;
  final Color accent;
  final Color accentForeground;
  final Color destructive;
  final Color destructiveForeground;
  final Color border;
  final Color input;
  final Color ring;

  /// Reserved for provider-confirmed success — a call that actually connected.
  final Color positive;

  /// Reserved for states that need attention but are not failures.
  final Color warning;

  /// Series colours, in order, for charts.
  final List<Color> chart;

  static const light = DialoColors(
    background: Color(0xFFFAFAF9),
    foreground: Color(0xFF1C1917),
    card: Color(0xFFFFFFFF),
    cardForeground: Color(0xFF1C1917),
    primary: Color(0xFF4F46E5),
    primaryForeground: Color(0xFFFFFFFF),
    secondary: Color(0xFFF5F5F4),
    secondaryForeground: Color(0xFF44403C),
    muted: Color(0xFFF5F5F4),
    mutedForeground: Color(0xFF78716C),
    accent: Color(0xFFEEF2FF),
    accentForeground: Color(0xFF3730A3),
    destructive: Color(0xFFDC2626),
    destructiveForeground: Color(0xFFFFFFFF),
    border: Color(0xFFE7E5E4),
    input: Color(0xFFD6D3D1),
    ring: Color(0xFF4F46E5),
    positive: Color(0xFF0F766E),
    warning: Color(0xFFB45309),
    chart: [
      Color(0xFF4F46E5),
      Color(0xFF0F766E),
      Color(0xFFB45309),
      Color(0xFFB91C1C),
      Color(0xFF64748B),
    ],
  );

  static const dark = DialoColors(
    background: Color(0xFF0C0A09),
    foreground: Color(0xFFFAFAF9),
    card: Color(0xFF171514),
    cardForeground: Color(0xFFFAFAF9),
    primary: Color(0xFF818CF8),
    primaryForeground: Color(0xFF1E1B4B),
    secondary: Color(0xFF292524),
    secondaryForeground: Color(0xFFE7E5E4),
    muted: Color(0xFF1C1917),
    mutedForeground: Color(0xFFA8A29E),
    accent: Color(0xFF272449),
    accentForeground: Color(0xFFC7D2FE),
    destructive: Color(0xFFF87171),
    destructiveForeground: Color(0xFF450A0A),
    border: Color(0xFF292524),
    input: Color(0xFF44403C),
    ring: Color(0xFF818CF8),
    positive: Color(0xFF2DD4BF),
    warning: Color(0xFFFBBF24),
    chart: [
      Color(0xFF818CF8),
      Color(0xFF2DD4BF),
      Color(0xFFFBBF24),
      Color(0xFFFB7185),
      Color(0xFF94A3B8),
    ],
  );
}

/// A 4px spacing scale. Every gap and inset in the app is one of these, which
/// is what keeps rhythm consistent across screens written at different times.
abstract final class Space {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double base = 16;
  static const double lg = 24;
  static const double xl = 32;
  static const double xxl = 48;
}

/// Restrained corner radii. Large radii everywhere is one of the tells of a
/// generated interface; these stay close to the web client's 0.5rem.
abstract final class Radii {
  static const double sm = 5;
  static const double md = 6;
  static const double lg = 8;
  static const double xl = 12;

  static const BorderRadius cardRadius = BorderRadius.all(Radius.circular(lg));
  static const BorderRadius controlRadius = BorderRadius.all(Radius.circular(md));
}

/// Motion durations, shared so transitions across the app agree with each other.
abstract final class Motion {
  static const Duration fast = Duration(milliseconds: 160);
  static const Duration base = Duration(milliseconds: 240);
  static const Duration slow = Duration(milliseconds: 380);

  static const Curve ease = Curves.easeOutCubic;
  static const Curve easeInOut = Curves.easeInOutCubic;
}

/// Layout breakpoints. Mobile gets its own navigation and list layouts rather
/// than a scaled-down desktop table.
abstract final class Breakpoints {
  static const double mobile = 640;
  static const double tablet = 1024;

  static bool isMobile(BuildContext context) =>
      MediaQuery.sizeOf(context).width < mobile;

  static bool isTablet(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    return width >= mobile && width < tablet;
  }

  static bool isDesktop(BuildContext context) =>
      MediaQuery.sizeOf(context).width >= tablet;
}
