// ============================================================
// Dialo AI — Theme
// ============================================================
//
// Builds Material themes from the shared tokens, and exposes the palette to
// widgets through an extension so nothing has to reach for a hardcoded colour.
//
// Read a colour with `context.colors.mutedForeground`, never with a literal.
// ============================================================

import 'package:flutter/material.dart';

import 'tokens.dart';

/// Carries the palette down the tree so widgets can read it from context.
@immutable
class DialoTheme extends ThemeExtension<DialoTheme> {
  const DialoTheme({required this.colors});

  final DialoColors colors;

  @override
  DialoTheme copyWith({DialoColors? colors}) =>
      DialoTheme(colors: colors ?? this.colors);

  // Colour sets are swapped whole rather than blended: a half-interpolated
  // palette during a theme change is never what is wanted here.
  @override
  DialoTheme lerp(covariant DialoTheme? other, double t) =>
      t < 0.5 ? this : (other ?? this);
}

extension DialoThemeContext on BuildContext {
  DialoColors get colors =>
      Theme.of(this).extension<DialoTheme>()?.colors ?? DialoColors.light;

  TextTheme get text => Theme.of(this).textTheme;
}

/// The typographic scale.
///
/// Deliberately tight: a B2B console is read, not admired. Sizes step in small
/// increments and weight does most of the hierarchy work, which reads as more
/// considered than large display type.
TextTheme _textTheme(DialoColors colors) {
  final base = ThemeData.light().textTheme;
  return base
      .copyWith(
        displaySmall: const TextStyle(
          fontSize: 28,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.5,
          height: 1.2,
        ),
        headlineSmall: const TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.3,
          height: 1.25,
        ),
        titleMedium: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.1,
          height: 1.35,
        ),
        titleSmall: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          height: 1.35,
        ),
        bodyLarge: const TextStyle(fontSize: 15, height: 1.5),
        bodyMedium: const TextStyle(fontSize: 14, height: 1.5),
        bodySmall: const TextStyle(fontSize: 13, height: 1.45),
        labelLarge: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w500,
          height: 1.3,
        ),
        labelSmall: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w500,
          height: 1.3,
        ),
      )
      .apply(bodyColor: colors.foreground, displayColor: colors.foreground);
}

ThemeData _build(DialoColors colors, Brightness brightness) {
  final text = _textTheme(colors);

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    scaffoldBackgroundColor: colors.background,
    canvasColor: colors.background,
    colorScheme: ColorScheme(
      brightness: brightness,
      primary: colors.primary,
      onPrimary: colors.primaryForeground,
      secondary: colors.secondary,
      onSecondary: colors.secondaryForeground,
      error: colors.destructive,
      onError: colors.destructiveForeground,
      surface: colors.card,
      onSurface: colors.cardForeground,
      outline: colors.border,
      surfaceContainerHighest: colors.muted,
    ),
    textTheme: text,
    dividerTheme: DividerThemeData(
      color: colors.border,
      thickness: 1,
      space: 1,
    ),
    extensions: [DialoTheme(colors: colors)],

    // Flat, bordered surfaces. No elevation: stacked shadows are the fastest
    // way to make a dense console look like a template.
    cardTheme: CardThemeData(
      color: colors.card,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: Radii.cardRadius,
        side: BorderSide(color: colors.border),
      ),
    ),

    appBarTheme: AppBarTheme(
      backgroundColor: colors.card,
      foregroundColor: colors.foreground,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: text.titleMedium,
      shape: Border(bottom: BorderSide(color: colors.border)),
    ),

    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: colors.primary,
        foregroundColor: colors.primaryForeground,
        // A real target size on touch devices; 44px is the accessible minimum.
        minimumSize: const Size(0, 44),
        padding: const EdgeInsets.symmetric(horizontal: Space.base),
        shape: const RoundedRectangleBorder(borderRadius: Radii.controlRadius),
        textStyle: text.labelLarge,
      ),
    ),

    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: colors.foreground,
        minimumSize: const Size(0, 44),
        padding: const EdgeInsets.symmetric(horizontal: Space.base),
        side: BorderSide(color: colors.border),
        shape: const RoundedRectangleBorder(borderRadius: Radii.controlRadius),
        textStyle: text.labelLarge,
      ),
    ),

    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: colors.primary,
        minimumSize: const Size(0, 40),
        textStyle: text.labelLarge,
      ),
    ),

    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colors.card,
      contentPadding: const EdgeInsets.symmetric(
        horizontal: Space.md,
        vertical: Space.md,
      ),
      hintStyle: text.bodyMedium?.copyWith(color: colors.mutedForeground),
      labelStyle: text.bodySmall?.copyWith(color: colors.mutedForeground),
      border: OutlineInputBorder(
        borderRadius: Radii.controlRadius,
        borderSide: BorderSide(color: colors.input),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: Radii.controlRadius,
        borderSide: BorderSide(color: colors.input),
      ),
      // A visible focus ring is the difference between a keyboard-usable form
      // and one that silently loses the person tabbing through it.
      focusedBorder: OutlineInputBorder(
        borderRadius: Radii.controlRadius,
        borderSide: BorderSide(color: colors.ring, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: Radii.controlRadius,
        borderSide: BorderSide(color: colors.destructive),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: Radii.controlRadius,
        borderSide: BorderSide(color: colors.destructive, width: 2),
      ),
    ),

    dialogTheme: DialogThemeData(
      backgroundColor: colors.card,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.all(Radius.circular(Radii.xl)),
        side: BorderSide(color: colors.border),
      ),
      titleTextStyle: text.headlineSmall,
      contentTextStyle: text.bodyMedium,
    ),

    snackBarTheme: SnackBarThemeData(
      backgroundColor: colors.foreground,
      contentTextStyle: text.bodyMedium?.copyWith(color: colors.background),
      behavior: SnackBarBehavior.floating,
      shape: const RoundedRectangleBorder(borderRadius: Radii.controlRadius),
    ),

    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: colors.primary,
      linearMinHeight: 2,
    ),

    tooltipTheme: TooltipThemeData(
      decoration: BoxDecoration(
        color: colors.foreground,
        borderRadius: Radii.controlRadius,
      ),
      textStyle: text.bodySmall?.copyWith(color: colors.background),
    ),
  );
}

ThemeData buildLightTheme() => _build(DialoColors.light, Brightness.light);
ThemeData buildDarkTheme() => _build(DialoColors.dark, Brightness.dark);
