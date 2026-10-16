import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:go_router/go_router.dart';
import 'package:developify_mobile/app/di/app_dependencies.dart';
import 'package:developify_mobile/app/router/app_router.dart';
import 'package:developify_mobile/app/router/route_names.dart';
import 'package:developify_mobile/core/theme/app_theme.dart';
import 'package:developify_mobile/features/authentication/domain/auth_repository.dart';

class DevelopifyApp extends StatefulWidget {
  const DevelopifyApp({super.key, required this.dependencies, this.router});
  final AppDependencies dependencies;
  final GoRouter? router;
  @override
  State<DevelopifyApp> createState() => _DevelopifyAppState();
}

class _DevelopifyAppState extends State<DevelopifyApp> {
  late final GoRouter _router =
      widget.router ?? createAppRouter(widget.dependencies);
  StreamSubscription<void>? _passwordRecovery;
  @override
  void initState() {
    super.initState();
    widget.dependencies.session.startExpiryMonitoring();
    final authRepository = widget.dependencies.container<AuthRepository>();
    _passwordRecovery = authRepository.passwordRecoveryEvents.listen((_) {
      _router.goNamed(
        Routes.recovery,
        queryParameters: const {'reset': 'true'},
      );
    });
    if (authRepository.passwordRecoveryPending) {
      scheduleMicrotask(
        () => _router.goNamed(
          Routes.recovery,
          queryParameters: const {'reset': 'true'},
        ),
      );
    }
  }

  @override
  void dispose() {
    widget.dependencies.session.stopExpiryMonitoring();
    unawaited(_passwordRecovery?.cancel());
    if (widget.router == null) _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ScreenUtilInit(
    designSize: const Size(393, 852),
    minTextAdapt: true,
    splitScreenMode: true,
    builder: (context, child) => MaterialApp.router(
      title: 'Developify',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      builder: (context, child) => AnnotatedRegion<SystemUiOverlayStyle>(
        value: SystemUiOverlayStyle.dark,
        child: child!,
      ),
      routerConfig: _router,
    ),
  );
}
