import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:developify_mobile/core/theme/app_theme.dart';
import 'package:developify_mobile/features/shared/domain/app_user.dart';

class AccountIdentityCard extends StatelessWidget {
  const AccountIdentityCard({
    super.key,
    required this.user,
  });

  final AppUser user;

  @override
  Widget build(BuildContext context) => Container(
    margin: EdgeInsets.only(top: 16.w),
    padding: EdgeInsets.all(14.w),
    decoration: BoxDecoration(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(12.r),
      border: Border.all(color: AppColors.borderStrong),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Current account',
          style: AppTextStyles.text(
            13,
            weight: FontWeight.w600,
            color: AppColors.text,
          ),
        ),
        SizedBox(height: 8.w),
        Text(user.email, style: AppTextStyles.text(12, color: AppColors.muted)),
        SizedBox(height: 4.w),
        SelectableText(
          'Account ID: ${user.id}',
          style: AppTextStyles.text(11, color: AppColors.muted),
        ),
      ],
    ),
  );
}
