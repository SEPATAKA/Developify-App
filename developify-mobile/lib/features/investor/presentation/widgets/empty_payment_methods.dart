import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:developify_mobile/core/theme/app_theme.dart';
import 'package:developify_mobile/core/widgets/app_button.dart';

class EmptyPaymentMethods extends StatelessWidget {
  const EmptyPaymentMethods({
    super.key,
    required this.withdrawal,
    required this.onAdd,
    this.manualEft = false,
    this.paymentsUnavailable = false,
  });
  final bool withdrawal;
  final VoidCallback onAdd;
  final bool manualEft;
  final bool paymentsUnavailable;
  @override
  Widget build(BuildContext context) => ListView(
    children: [
      SizedBox(height: 248.w),
      Padding(
        padding: EdgeInsets.symmetric(horizontal: 16.w),
        child: Column(
          children: [
            Text(
              paymentsUnavailable
                  ? 'Deposits temporarily unavailable'
                  : withdrawal || manualEft
                  ? 'No bank accounts added'
                  : 'No Cards Added Yet',
              textAlign: TextAlign.center,
              style: AppTextStyles.text(16, weight: FontWeight.w600),
            ),
            SizedBox(height: 12.w),
            Text(
              withdrawal
                  ? 'Add a bank account for withdrawals.'
                  : manualEft
                  ? 'Add a bank account to request a manual EFT deposit.'
                  : paymentsUnavailable
                  ? 'Card checkout and a verified bank settlement account are not configured. Please contact support.'
                  : "You haven't added any cards yet. Add a card to start making payments and managing your transactions.",
              textAlign: TextAlign.center,
              style: AppTextStyles.body,
            ),
          ],
        ),
      ),
      if (!paymentsUnavailable) ...[
        SizedBox(height: 35.w),
        AppButton(
          label: withdrawal || manualEft ? 'Add Bank Account' : 'Add Card',
          onPressed: onAdd,
        ),
      ],
      SizedBox(height: 24.w),
    ],
  );
}
