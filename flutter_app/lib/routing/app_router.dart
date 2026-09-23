// ============================================================
// Dialo AI — Routing
// ============================================================
//
// Route protection happens in one redirect, so there is no screen that can be
// reached without a session by navigating to its URL directly — which matters
// on Flutter Web, where the address bar is a real entry point.
//
// The redirect also refuses to show the login screen while the session is
// still being checked. Flashing a login form at someone who is already signed
// in, and then replacing it, is the usual symptom of getting this wrong.
// ============================================================

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth_controller.dart';
import '../features/auth/login_screen.dart';
import '../features/dashboard/dashboard_screen.dart';
import '../features/shell/app_shell.dart';
import '../services/api_client.dart';
import '../widgets/states.dart';

abstract final class Routes {
  static const login = '/login';
  static const dashboard = '/dashboard';
  static const leads = '/leads';
  static const upload = '/upload';
  static const campaigns = '/campaigns';
  static const results = '/results';
  static const followUps = '/follow-ups';
  static const agent = '/agent';
  static const analytics = '/analytics';
  static const settings = '/settings';
}

GoRouter buildRouter({
  required AuthController auth,
  required ApiClient api,
}) {
  return GoRouter(
    initialLocation: Routes.dashboard,
    // Re-evaluates the redirect whenever sign-in state changes, which is what
    // signs the user out of a screen the moment their session is rejected.
    refreshListenable: auth,
    redirect: (context, state) {
      final location = state.matchedLocation;

      // Still asking the server who this is: hold position rather than guess.
      if (auth.status == AuthStatus.checking) {
        return location == '/loading' ? null : '/loading';
      }

      final signedIn = auth.status == AuthStatus.signedIn;
      final atLogin = location == Routes.login;

      if (!signedIn) return atLogin ? null : Routes.login;
      if (atLogin || location == '/loading') return Routes.dashboard;
      return null;
    },
    routes: [
      GoRoute(
        path: '/loading',
        builder: (context, state) =>
            const Scaffold(body: LoadingState(label: 'Checking your session')),
      ),
      GoRoute(
        path: Routes.login,
        builder: (context, state) => LoginScreen(auth: auth),
      ),
      // Everything below shares the navigation chrome.
      ShellRoute(
        builder: (context, state, child) => AppShell(
          auth: auth,
          location: state.matchedLocation,
          child: child,
        ),
        routes: [
          GoRoute(
            path: Routes.dashboard,
            pageBuilder: (context, state) =>
                _fade(state, DashboardScreen(api: api)),
          ),
        ],
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      body: EmptyState(
        title: 'Page not found',
        message: 'There is nothing at ${state.uri.path}.',
        icon: Icons.help_outline,
        action: FilledButton(
          onPressed: () => context.go(Routes.dashboard),
          child: const Text('Go to dashboard'),
        ),
      ),
    ),
  );
}

/// A short cross-fade between screens.
///
/// Slides and scales are avoided on purpose: this is a console people move
/// through quickly, and motion that has to finish before the next screen is
/// readable becomes a tax paid on every navigation.
CustomTransitionPage<void> _fade(GoRouterState state, Widget child) {
  return CustomTransitionPage<void>(
    key: state.pageKey,
    child: child,
    transitionDuration: const Duration(milliseconds: 160),
    transitionsBuilder: (context, animation, secondaryAnimation, child) =>
        FadeTransition(opacity: animation, child: child),
  );
}
