// ============================================================
// Dialo AI — Entry Point
// ============================================================
//
// Builds the three long-lived objects — the API client, the auth controller
// and the router — and resolves the session before the first frame decides
// which screen to show.
// ============================================================

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'auth/auth_controller.dart';
import 'routing/app_router.dart';
import 'services/api_client.dart';
import 'theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const DialoApp());
}

class DialoApp extends StatefulWidget {
  const DialoApp({super.key});

  @override
  State<DialoApp> createState() => _DialoAppState();
}

class _DialoAppState extends State<DialoApp> {
  late final ApiClient _api;
  late final AuthController _auth;
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    _api = ApiClient();
    _auth = AuthController(_api);
    _router = buildRouter(auth: _auth, api: _api);

    // Asks the server who this is. Until it answers the router holds on the
    // loading route, so nobody is shown a login form they do not need.
    _auth.restore();
  }

  @override
  void dispose() {
    _auth.dispose();
    _api.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Dialo',
      debugShowCheckedModeBanner: false,
      theme: buildLightTheme(),
      darkTheme: buildDarkTheme(),
      themeMode: ThemeMode.system,
      routerConfig: _router,
    );
  }
}
