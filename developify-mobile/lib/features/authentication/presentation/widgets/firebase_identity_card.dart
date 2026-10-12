import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:developify_mobile/core/theme/app_theme.dart';
import 'package:developify_mobile/features/shared/domain/app_user.dart';

class FirebaseIdentityCard extends StatelessWidget {
  const FirebaseIdentityCard({
    super.key,
    required this.user,
    required this.firebaseIdentity,
  });

  final AppUser user;
  final bool firebaseIdentity;

  @override
  Widget build(BuildContext context) => Container(
    margin: EdgeInsets.only(top: 16.w),
    padding: EdgeInsets.all(14.w),
    decoration: BoxDecoration(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(12.r),
      border: Border.all(color: Colors.black12),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          firebaseIdentity ? 'Signed in with Firebase' : 'Current account',
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
          '${firebaseIdentity ? 'Firebase UID' : 'Account ID'}: ${user.id}',
          style: AppTextStyles.text(11, color: AppColors.muted),
        ),
      ],
    ),
  );
}
