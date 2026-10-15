import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_mobx/flutter_mobx.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:developify_mobile/core/assets/app_assets.dart';
import 'package:developify_mobile/core/errors/result.dart';
import 'package:developify_mobile/core/models/monetary_amount.dart';
import 'package:developify_mobile/core/theme/app_theme.dart';
import 'package:developify_mobile/core/utils/money.dart';
import 'package:developify_mobile/core/widgets/app_button.dart';
import 'package:developify_mobile/core/widgets/app_icon.dart';
import 'package:developify_mobile/core/widgets/states.dart';
import 'package:developify_mobile/features/investor/domain/investor_account.dart';
import 'package:developify_mobile/features/investor/domain/investor_drafts.dart';
import 'package:developify_mobile/features/investor/presentation/investor_route_names.dart';
import 'package:developify_mobile/features/investor/presentation/stores/transfer_store.dart';
import 'package:developify_mobile/features/investor/presentation/widgets/investor_amount_field.dart';
import 'package:developify_mobile/features/investor/presentation/widgets/investor_components.dart';
import 'package:developify_mobile/features/investor/presentation/widgets/investor_confirmation_sheet.dart';
import 'package:developify_mobile/features/investor/presentation/widgets/empty_payment_methods.dart';
import 'package:developify_mobile/features/investor/presentation/widgets/deposit_account_details.dart';
import 'package:developify_mobile/features/investor/presentation/widgets/transfer_summary.dart';
import 'package:developify_mobile/features/investor/presentation/widgets/withdrawal_amount_form.dart';
import 'package:developify_mobile/features/investor/presentation/widgets/withdrawal_review.dart';

class TransferScreen extends StatefulWidget {
  const TransferScreen({
    super.key,
    required this.store,
    this.returnProjectId,
    this.returnAmountCents,
  });
  final TransferStore store;
  final String? returnProjectId;
  final String? returnAmountCents;
  @override
  State<TransferScreen> createState() => _TransferScreenState();
}

class _TransferScreenState extends State<TransferScreen> {
  @override
  Widget build(BuildContext context) => Observer(
    builder: (_) => PopScope<Object?>(
      canPop:
          widget.store.account == null ||
          widget.store.stage == TransferStage.success ||
          widget.store.stage == TransferStage.method ||
          (widget.store.kind == InvestorTransferKind.withdrawal &&
              widget.store.stage == TransferStage.amount),
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: _page(context),
    ),
  );

  Widget _page(BuildContext context) {
    final store = widget.store;
    final withdrawal = store.kind == InvestorTransferKind.withdrawal;
    if (store.account == null) {
      return InvestorPage(
        title: withdrawal ? 'Withdrawal' : 'Add funds',
        onBack: _back,
        child: store.status == LoadStatus.error
            ? ErrorView(
                message: store.error ?? 'Unable to load payment methods.',
                onRetry: () => store.load(store.kind),
              )
            : const LoadingView(),
      );
    }
    if (store.stage == TransferStage.bankDetails) {
      return InvestorPage(
        title: 'Bank Transfer',
        onBack: _back,
        bottom: AppButton(
          label: 'Continue',
          onPressed: () {
            store.chooseKind(PaymentMethodKind.bankAccount);
          },
        ),
        child: ListView(
          key: const ValueKey('transfer-bank-details'),
          children: [
            SizedBox(height: 18.w),
            Text(
              'Demo account details. Continue below to simulate a bank transfer.',
              style: AppTextStyles.body,
            ),
            SizedBox(height: 14.w),
            const DepositAccountDetails(),
            SizedBox(height: 24.w),
          ],
        ),
      );
    }
    if (store.stage == TransferStage.method) {
      return InvestorPage(
        title: 'Add funds',
        onBack: _back,
        child: ListView(
          key: const ValueKey('transfer-payment-type'),
          children: [
            SizedBox(height: 18.w),
            Text(
              store.cardPaymentsEnabled
                  ? 'Choose how to add funds'
                  : 'Add funds by bank transfer',
              style: AppTextStyles.heading,
            ),
            SizedBox(height: 17.w),
            Text(
              store.cardPaymentsEnabled
                  ? store.supportsManualEft
                        ? 'Pay by card in Paystack’s secure test checkout, or request a manual bank transfer. Your wallet is credited only after payment is confirmed.'
                        : 'Pay by card or try a demo bank transfer. Demo transactions do not move real money.'
                  : store.supportsManualEft
                  ? 'Create a deposit request, then transfer the exact amount using the reference provided. Funds are added after admin confirmation.'
                  : 'Add funds by bank transfer.',
              style: AppTextStyles.body,
            ),
            SizedBox(height: 18.w),
            if (store.cardPaymentsEnabled)
              InvestorMenuRow(
                icon: AppAssets.investorTransferCard,
                radius: 12,
                padding: EdgeInsets.symmetric(horizontal: 15.w, vertical: 15.w),
                iconGap: 16,
                subtitleGap: 4,
                title: 'Debit Card',
                titleSize: 16,
                subtitleSize: 14,
                subtitleColor: AppColors.iconMuted,
                subtitleWeight: FontWeight.w500,
                badge: Container(
                  constraints: BoxConstraints(minWidth: 91.w),
                  padding: EdgeInsets.symmetric(horizontal: 9.w, vertical: 4.w),
                  decoration: BoxDecoration(
                    color: AppColors.mintBorder,
                    borderRadius: BorderRadius.circular(20.r),
                  ),
                  child: Text(
                    'Most popular',
                    textAlign: TextAlign.center,
                    style: AppTextStyles.text(
                      11,
                      color: AppColors.mintText,
                      weight: FontWeight.w600,
                    ),
                  ),
                ),
                subtitle: 'Paystack secure checkout • Test mode',
                trailing: const AppIcon(AppAssets.profileMenuChevron),
                onTap: () => store.chooseKind(PaymentMethodKind.card),
              ),
            if (store.bankTransferAvailable) ...[
              if (store.cardPaymentsEnabled) SizedBox(height: 19.w),
              InvestorMenuRow(
                icon: AppAssets.investorBank,
                iconGap: 16,
                radius: 12,
                padding: EdgeInsets.symmetric(horizontal: 15.w, vertical: 16.w),
                subtitleGap: 4,
                title: 'Bank Transfer',
                titleSize: 16,
                subtitleSize: 14,
                subtitleColor: AppColors.iconMuted,
                subtitleWeight: FontWeight.w500,
                subtitle: store.supportsManualEft
                    ? 'Manual EFT • Pending admin confirmation'
                    : 'Demo bank transfer • Simulated',
                trailing: const AppIcon(AppAssets.profileMenuChevron),
                onTap: () => store.supportsManualEft
                    ? store.chooseKind(PaymentMethodKind.bankAccount)
                    : store.showBankDetails(),
              ),
            ],
          ],
        ),
      );
    }
    final reviewing = store.stage != TransferStage.amount;
    final amount = store.amount ?? const MonetaryAmount(0, Currency.zar);
    final method = store.method;
    if (!store.methods.any((method) => method.kind == store.paymentKind) &&
        store.stage == TransferStage.amount) {
      return InvestorPage(
        title: withdrawal
            ? 'Withdraw'
            : store.supportsManualEft
            ? 'Bank Transfer'
            : 'Pay with Card',
        onBack: _back,
        child: EmptyPaymentMethods(
          withdrawal: withdrawal,
          manualEft: store.supportsManualEft,
          onAdd: _addMethod,
        ),
      );
    }
    final bankDeposit =
        !withdrawal && method?.kind == PaymentMethodKind.bankAccount;
    final methodTitle = method == null
        ? 'No payment method'
        : method.lastFour.isEmpty
        ? method.name
        : '${method.name} • ****** ${method.lastFour}';
    return InvestorPage(
      footerBottomInset: withdrawal ? 9 : 18,
      title: reviewing
          ? withdrawal
                ? 'Confirm Withdrawal'
                : 'Confirm Top- Up'
          : withdrawal
          ? 'Withdraw'
          : bankDeposit
          ? 'Bank Transfer'
          : 'Pay with Card',
      onBack: _back,
      bottom: AppButton(
        label: reviewing
            ? withdrawal
                  ? 'Authorize with PIN'
                  : 'Confirm Payment'
            : withdrawal
            ? 'Withdraw'
            : 'Continue',
        loading: store.stage == TransferStage.processing,
        onPressed: reviewing
            ? _authorize
            : store.validAmount && method != null
            ? () => store.review()
            : null,
      ),
      child: ListView(
        key: ValueKey(reviewing ? 'transfer-review' : 'transfer-amount'),
        children: [
          SizedBox(
            height: withdrawal
                ? reviewing
                      ? 21.w
                      : store.amountText.isEmpty
                      ? 36.w
                      : 38.w
                : reviewing
                ? 45.w
                : 39.w,
          ),
          if (withdrawal)
            reviewing
                ? WithdrawalReview(
                    amount: amount,
                    fee: store.fee,
                    received: store.received,
                    method: method,
                  )
                : WithdrawalAmountForm(store: store, onAdd: _addMethod)
          else if (!reviewing) ...[
            InvestorAmountField(
              value: store.amountText,
              onChanged: store.editAmount,
              error: store.inputError,
              fontSize: 61,
              fontWeight: FontWeight.w600,
              labelGap: 8,
            ),
            SizedBox(height: 86.w),
            InvestorAmountPresets(
              values: const [500, 1000, 2000, 5000],
              onSelected: store.editAmount,
              selectedValue: store.amountText,
            ),
            SizedBox(height: 24.w),
            InvestorMenuRow(
              icon: method!.kind == PaymentMethodKind.card
                  ? AppAssets.investorTransferCard
                  : AppAssets.investorBank,
              iconColor: AppColors.investorPaymentIcon,
              titleSize: 16,
              subtitleSize: 14,
              subtitleColor: AppColors.iconMuted,
              subtitleWeight: FontWeight.w500,
              subtitleGap: 4,
              radius: 12,
              padding: EdgeInsets.symmetric(horizontal: 15.w, vertical: 16.w),
              title: methodTitle,
              subtitle: method.expiry.isEmpty
                  ? method.holder
                  : 'Default • expires ${method.expiry}',
              trailing: Text(
                'Change',
                style: AppTextStyles.text(
                  16,
                  weight: FontWeight.w600,
                  color: AppColors.primary,
                ),
              ),
              onTap: bankDeposit ? store.showBankDetails : _selectMethod,
            ),
            SizedBox(height: 15.w),
            TransferFees(
              amount: amount,
              fee: store.fee,
              bankDeposit: bankDeposit,
            ),
          ] else
            TransferReview(
              amount: amount,
              fee: store.fee,
              method: method,
              manualEft: store.supportsManualEft && !withdrawal,
            ),
          if (store.error != null) InlineError(store.error),
          SizedBox(height: 24.w),
        ],
      ),
    );
  }

  void _back() {
    final store = widget.store;
    if (store.stage == TransferStage.processing) return;
    FocusManager.instance.primaryFocus?.unfocus();
    if (store.stage == TransferStage.bankDetails) {
      store.leaveBankDetails();
    } else if (store.stage == TransferStage.review ||
        store.stage == TransferStage.authorizing ||
        store.stage == TransferStage.failure) {
      store.adjustAmount();
    } else if (store.account != null &&
        store.kind == InvestorTransferKind.topUp &&
        store.stage == TransferStage.amount) {
      store.showPaymentTypes();
    } else if (context.canPop()) {
      context.pop();
    } else {
      context.goNamed(InvestorRoutes.wallet);
    }
  }

  Future<void> _selectMethod() async {
    final id = await context.pushNamed<String>(
      InvestorRoutes.paymentMethods,
      queryParameters: {
        'select': 'true',
        'kind': widget.store.kind == InvestorTransferKind.withdrawal
            ? 'bankAccount'
            : widget.store.paymentKind.name,
      },
    );
    if (mounted && id != null) {
      await widget.store.refreshMethods();
      if (mounted) widget.store.selectMethod(id);
    }
  }

  Future<void> _addMethod() async {
    if (widget.store.kind == InvestorTransferKind.topUp &&
        widget.store.cardPaymentsEnabled) {
      widget.store.selectMethod(InvestorDepositAccount.paystackMethod.id);
      return;
    }
    final id = await context.pushNamed<String>(
      widget.store.kind == InvestorTransferKind.withdrawal
          ? InvestorRoutes.addBank
          : widget.store.cardPaymentsEnabled
          ? InvestorRoutes.addCard
          : InvestorRoutes.addBank,
      queryParameters: const {'select': 'true'},
    );
    if (mounted && id != null) {
      await widget.store.refreshMethods();
      if (mounted) widget.store.selectMethod(id);
    }
  }

  Future<void> _authorize() async {
    final store = widget.store;
    final withdrawal = store.kind == InvestorTransferKind.withdrawal;
    final destination = store.method;
    store.authorize();
    final success = await showInvestorAuthorization(
      context,
      processingTitle: withdrawal
          ? 'Recording withdrawal'
          : 'Processing your request',
      processingMessage: withdrawal
          ? store.supportsManualEft
                ? 'Please wait while we submit your withdrawal for admin approval.'
                : 'Please wait while we record this simulated withdrawal.'
          : store.supportsManualEft &&
                store.method?.kind == PaymentMethodKind.bankAccount
          ? 'Please wait while we create your manual EFT deposit request.'
          : store.cardPaymentsEnabled &&
                store.method?.kind == PaymentMethodKind.card
          ? 'Please wait while we prepare your secure Paystack test checkout.'
          : 'Please wait while we confirm this simulation.',
      processingBottomSpacing: withdrawal ? 106 : 39,
      allowDemoBiometricAuthorization: store.allowDemoBiometricAuthorization,
      authorize: (pin, {simulateBiometric = false}) async {
        if (await store.confirm(pin, simulateBiometric: simulateBiometric)) {
          return InvestorAuthorizationOutcome.success;
        }
        return store.stage == TransferStage.authorizing
            ? InvestorAuthorizationOutcome.retryPin
            : InvestorAuthorizationOutcome.failed;
      },
      error: () => store.error,
    );
    if (!mounted) return;
    if (success == null) {
      store.cancelAuthorization();
      return;
    }
    final receiptId = store.receipt?.transactionId;
    final receipt = store.receipt;
    final instructions = receipt?.paymentInstructions;
    final checkoutUrl = receipt?.checkoutUrl;
    var checkoutOpened = false;
    if (success && checkoutUrl != null) {
      checkoutOpened = await _openCheckout(checkoutUrl);
      if (!mounted) return;
    }
    final isPending = receipt?.status == InvestorTransactionStatus.pending;
    final paystackDeposit = !withdrawal && checkoutUrl != null;
    final liveManualDeposit =
        !withdrawal &&
        destination?.kind == PaymentMethodKind.bankAccount &&
        store.supportsManualEft;
    final manualDepositAmount = instructions == null
        ? null
        : MonetaryAmount(instructions.amountCents, Currency.zar);
    final message = !success
        ? store.error ?? 'Please try again.'
        : withdrawal
        ? store.supportsManualEft
              ? isPending
                    ? '${Money.amount(store.amount!)} withdrawal request submitted to ${destination?.name ?? 'your bank account'}${destination == null ? '' : ' • ${destination.lastFour}'}. It is pending admin approval; the amount and fee are reserved from your wallet.'
                    : '${Money.amount(store.received)} withdrawal sent to ${destination?.name ?? 'your bank account'}${destination == null ? '' : ' • ${destination.lastFour}'}.'
              : '${Money.amount(store.received)} simulated withdrawal to ${destination?.name ?? 'the selected bank'}${destination == null ? '' : ' • ${destination.lastFour}'}. No money was moved.'
        : liveManualDeposit && isPending && instructions != null
        ? 'Deposit request pending. Transfer ${Money.amount(manualDepositAmount!)} to ${instructions.bank}, account ${instructions.accountNumber}, branch ${instructions.branchCode}. Use reference ${instructions.reference}. Your wallet is credited after admin confirmation.'
        : liveManualDeposit && isPending
        ? 'This deposit request is still pending. Check the transaction details or contact support for its bank-transfer reference before sending funds.'
        : paystackDeposit
        ? checkoutOpened
              ? 'Complete your card payment in Paystack’s secure test checkout. Your wallet is credited only after Paystack confirms the payment.'
              : 'The payment request is pending, but Paystack checkout did not open. Return to Wallet and try the pending payment again.'
        : liveManualDeposit
        ? 'Deposit confirmed. Your wallet has been credited.'
        : '${Money.amount(store.amount!)} added to your demo wallet.';
    final choice = await showInvestorResult(
      context,
      success: success,
      style: success
          ? withdrawal
                ? InvestorResultStyle.withdrawal
                : InvestorResultStyle.topUp
          : InvestorResultStyle.investment,
      title: success
          ? withdrawal
                ? isPending
                      ? 'Withdrawal Requested'
                      : 'Withdrawal Sent'
                : liveManualDeposit
                ? 'Deposit Request Pending'
                : paystackDeposit
                ? 'Card Payment Pending'
                : 'Top - up Successful'
          : 'Couldn’t complete',
      message: message,
      primary: success
          ? withdrawal
                ? 'Back to Wallet'
                : liveManualDeposit
                ? 'Back to Wallet'
                : paystackDeposit
                ? 'Back to Wallet'
                : widget.returnProjectId != null
                ? 'Return to investment'
                : 'Find a project to invest in'
          : 'Try again',
      secondary: success
          ? withdrawal
                ? store.supportsManualEft && isPending
                      ? 'View Request'
                      : 'View Receipt'
                : liveManualDeposit
                ? 'View Request'
                : paystackDeposit
                ? 'Open Checkout'
                : 'Back to Wallet'
          : null,
    );
    if (!mounted) return;
    if (success) {
      if (paystackDeposit && choice == 'secondary') {
        final opened = await _openCheckout(checkoutUrl);
        if (!mounted) return;
        if (!opened && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Unable to open the secure Paystack checkout.'),
            ),
          );
        }
      }
      if ((withdrawal || liveManualDeposit) &&
          choice == 'secondary' &&
          receiptId != null) {
        context.pushReplacementNamed(
          InvestorRoutes.transaction,
          pathParameters: {'id': receiptId},
        );
        return;
      }
      if (!withdrawal &&
          !liveManualDeposit &&
          choice == 'primary' &&
          widget.returnProjectId != null) {
        context.goNamed(
          InvestorRoutes.invest,
          pathParameters: {'id': widget.returnProjectId!},
          queryParameters: {
            if (widget.returnAmountCents != null)
              'amountCents': widget.returnAmountCents!,
          },
        );
        return;
      }
      context.goNamed(
        !withdrawal && !liveManualDeposit && choice == 'primary'
            ? InvestorRoutes.explore
            : InvestorRoutes.wallet,
      );
    } else {
      store.adjustAmount();
    }
  }

  Future<bool> _openCheckout(String checkoutUrl) async {
    try {
      return await launchUrl(
        Uri.parse(checkoutUrl),
        mode: LaunchMode.externalApplication,
      );
    } on PlatformException {
      return false;
    }
  }
}
