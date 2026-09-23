// ============================================================
// Dialo AI — Application Shell
// ============================================================
//
// Navigation chrome around every signed-in screen.
//
// The layout genuinely changes with width rather than scaling down: a sidebar
// on desktop, a drawer and bottom-anchored app bar on phones. §17 asks for
// exactly this — a narrow window gets a layout designed for it, not a squeezed
// copy of the wide one.
// ============================================================

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../auth/auth_controller.dart';
import '../../routing/app_router.dart';
import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';

class NavItem {
  const NavItem(this.label, this.icon, this.route);
  final String label;
  final IconData icon;
  final String route;
}

const _navItems = <NavItem>[
  NavItem('Overview', Icons.dashboard_outlined, Routes.dashboard),
  NavItem('Leads', Icons.people_outline, Routes.leads),
  NavItem('Upload', Icons.upload_file_outlined, Routes.upload),
  NavItem('Campaigns', Icons.campaign_outlined, Routes.campaigns),
  NavItem('Results', Icons.assignment_outlined, Routes.results),
  NavItem('Follow-ups', Icons.schedule_outlined, Routes.followUps),
  NavItem('AI agent', Icons.smart_toy_outlined, Routes.agent),
  NavItem('Analytics', Icons.insights_outlined, Routes.analytics),
  NavItem('Settings', Icons.settings_outlined, Routes.settings),
];

class AppShell extends StatelessWidget {
  const AppShell({
    super.key,
    required this.auth,
    required this.location,
    required this.child,
  });

  final AuthController auth;
  final String location;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final isMobile = Breakpoints.isMobile(context);
    final colors = context.colors;

    if (isMobile) {
      return Scaffold(
        appBar: AppBar(
          title: Text(_titleFor(location)),
          actions: [_AccountButton(auth: auth)],
        ),
        drawer: Drawer(
          backgroundColor: colors.card,
          child: SafeArea(child: _NavList(location: location, onTap: (route) {
            Navigator.of(context).pop();
            context.go(route);
          })),
        ),
        body: child,
      );
    }

    return Scaffold(
      body: Row(
        children: [
          Container(
            width: 232,
            decoration: BoxDecoration(
              color: colors.card,
              border: Border(right: BorderSide(color: colors.border)),
            ),
            child: SafeArea(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                        Space.base, Space.lg, Space.base, Space.base),
                    child: Text('Dialo', style: context.text.titleMedium),
                  ),
                  Expanded(
                    child: _NavList(
                      location: location,
                      onTap: (route) => context.go(route),
                    ),
                  ),
                ],
              ),
            ),
          ),
          Expanded(
            child: Column(
              children: [
                Container(
                  height: 56,
                  decoration: BoxDecoration(
                    color: colors.card,
                    border: Border(bottom: BorderSide(color: colors.border)),
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: Space.lg),
                  child: Row(
                    children: [
                      Text(_titleFor(location), style: context.text.titleMedium),
                      const Spacer(),
                      _AccountButton(auth: auth),
                    ],
                  ),
                ),
                Expanded(child: child),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _titleFor(String location) {
    for (final item in _navItems) {
      if (location.startsWith(item.route)) return item.label;
    }
    return 'Dialo';
  }
}

class _NavList extends StatelessWidget {
  const _NavList({required this.location, required this.onTap});

  final String location;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: Space.sm),
      itemCount: _navItems.length,
      itemBuilder: (context, index) {
        final item = _navItems[index];
        final selected = location.startsWith(item.route);

        return Padding(
          padding: const EdgeInsets.only(bottom: 2),
          child: Semantics(
            selected: selected,
            button: true,
            child: InkWell(
              onTap: () => onTap(item.route),
              borderRadius: Radii.controlRadius,
              child: AnimatedContainer(
                duration: Motion.fast,
                curve: Motion.ease,
                padding: const EdgeInsets.symmetric(
                  horizontal: Space.md,
                  vertical: Space.md,
                ),
                decoration: BoxDecoration(
                  color: selected ? colors.accent : Colors.transparent,
                  borderRadius: Radii.controlRadius,
                ),
                child: Row(
                  children: [
                    Icon(
                      item.icon,
                      size: 18,
                      color: selected
                          ? colors.accentForeground
                          : colors.mutedForeground,
                    ),
                    const SizedBox(width: Space.md),
                    Text(
                      item.label,
                      style: context.text.bodyMedium?.copyWith(
                        color: selected
                            ? colors.accentForeground
                            : colors.foreground,
                        fontWeight:
                            selected ? FontWeight.w600 : FontWeight.w400,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _AccountButton extends StatelessWidget {
  const _AccountButton({required this.auth});

  final AuthController auth;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;

    return AnimatedBuilder(
      animation: auth,
      builder: (context, _) {
        final user = auth.user;
        if (user == null) return const SizedBox.shrink();

        return PopupMenuButton<String>(
          tooltip: 'Account',
          position: PopupMenuPosition.under,
          onSelected: (value) async {
            if (value != 'signout') return;

            // Signing out is not destructive, but it is disruptive enough to
            // be worth one confirmation rather than a mis-tap ending a session.
            final confirmed = await showDialog<bool>(
              context: context,
              builder: (context) => AlertDialog(
                title: const Text('Sign out?'),
                content: const Text(
                  'You will need to sign in again to place calls or view results.',
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(false),
                    child: const Text('Cancel'),
                  ),
                  FilledButton(
                    onPressed: () => Navigator.of(context).pop(true),
                    child: const Text('Sign out'),
                  ),
                ],
              ),
            );
            if (confirmed == true) await auth.signOut();
          },
          itemBuilder: (context) => [
            PopupMenuItem<String>(
              enabled: false,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(user.name, style: context.text.titleSmall),
                  Text(
                    user.email,
                    style: context.text.bodySmall
                        ?.copyWith(color: colors.mutedForeground),
                  ),
                  if (user.tenantName.isNotEmpty)
                    Text(
                      user.tenantName,
                      style: context.text.bodySmall
                          ?.copyWith(color: colors.mutedForeground),
                    ),
                ],
              ),
            ),
            const PopupMenuDivider(),
            const PopupMenuItem<String>(
              value: 'signout',
              child: Text('Sign out'),
            ),
          ],
          child: Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: colors.secondary,
              shape: BoxShape.circle,
              border: Border.all(color: colors.border),
            ),
            child: Text(user.initials, style: context.text.labelSmall),
          ),
        );
      },
    );
  }
}
