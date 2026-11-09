import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:go_router/go_router.dart';
import 'package:developify_mobile/features/investor/presentation/investor_route_names.dart';
import 'package:developify_mobile/app/router/route_names.dart';
import 'package:developify_mobile/core/theme/app_theme.dart';
import 'package:developify_mobile/core/widgets/app_button.dart';
import 'package:developify_mobile/core/widgets/app_chrome.dart';

class AuthCallbackScreen extends StatefulWidget {
  const AuthCallbackScreen({super.key, this.isPasswordRecovery = false});

  final bool isPasswordRecovery;

  @override
  State<AuthCallbackScreen> createState() => _AuthCallbackScreenState();
}

class _AuthCallbackScreenState extends State<AuthCallbackScreen> {
  @override
  void initState() {
    super.initState();
    if (widget.isPasswordRecovery) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          context.goNamed(
            Routes.recovery,
            queryParameters: const {'reset': 'true'},
          );
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: const AppPageAppBar(),
    body: SafeArea(
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: 24.w),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(height: 32.w),
            Text(
              widget.isPasswordRecovery
                  ? 'Password reset'
                  : 'Email verification',
              style: AppTextStyles.text(
                30,
                weight: FontWeight.w700,
                color: AppColors.black,
              ),
            ),
            SizedBox(height: 12.w),
            Text(
              widget.isPasswordRecovery
                  ? 'Your recovery link was verified. Continue to set a new password.'
                  : 'If you opened this page from a Supabase verification email, your email is confirmed. Sign in to finish creating your profile.',
              style: AppTextStyles.text(16, color: AppColors.muted),
            ),
            const Spacer(),
            if (widget.isPasswordRecovery)
              AppButton(
                label: 'Set a new password',
                onPressed: () => context.goNamed(
                  Routes.recovery,
                  queryParameters: const {'reset': 'true'},
                ),
              )
            else ...[
              AppButton(
                label: 'Continue as investor',
                onPressed: () => context.goNamed(InvestorRoutes.signIn),
              ),
              SizedBox(height: 12.w),
              AppButton(
                label: 'Continue as landowner',
                onPressed: () => context.goNamed(Routes.signIn),
              ),
            ],
            SizedBox(height: 20.w),
          ],
        ),
      ),
    ),
  );
}
