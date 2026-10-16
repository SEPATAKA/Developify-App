import 'dart:async';

import 'package:developify_mobile/core/assets/app_assets.dart';
import 'package:developify_mobile/core/errors/result.dart';
import 'package:developify_mobile/core/models/monetary_amount.dart';
import 'package:developify_mobile/core/network/api_client.dart';
import 'package:developify_mobile/features/investor/domain/account_summary.dart';
import 'package:developify_mobile/features/investor/domain/investment_policy.dart';
import 'package:developify_mobile/features/investor/domain/investor_account.dart';
import 'package:developify_mobile/features/investor/domain/investor_account_context.dart';
import 'package:developify_mobile/features/investor/domain/investor_project.dart';
import 'package:developify_mobile/features/investor/domain/investor_repository.dart';
import 'package:developify_mobile/features/shared/domain/app_user.dart';

final class ApiInvestorAccountRepository implements InvestorAccountRepository {
  ApiInvestorAccountRepository(this._client, this._context);

  final ApiClient _client;
  final InvestorAccountContext _context;
  final _changes = StreamController<InvestorAccountChange>.broadcast();
  final _pendingDepositChecks = <String>{};
  bool _balanceVisible = true;
  bool _cardPaymentsEnabled = false;
  bool _manualEftEnabled = false;
  bool _disposed = false;
  InvestorAccountSnapshot? _snapshot;
  int _sequence = 0;

  String get _entity => _context.entity.name;

  @override
  Set<PaymentMethodKind> get supportedPaymentMethods => {
    if (_manualEftEnabled) PaymentMethodKind.bankAccount,
    if (_cardPaymentsEnabled) PaymentMethodKind.card,
  };

  @override
  bool get usesLivePayments => true;

  @override
  bool get supportsManualEft => _manualEftEnabled;

  @override
  bool get allowsDemoBiometricAuthorization => false;

  @override
  Stream<InvestorAccountChange> get changes => _changes.stream;

  @override
  bool get balanceVisible => _balanceVisible;

  @override
  void setBalanceVisible(bool visible) {
    _balanceVisible = visible;
    _changes.add(const InvestorAccountChange({InvestorDataKind.privacy}));
  }

  InvestorTransaction _mapTx(Object? json) {
    final map = json as Map<String, Object?>? ?? const {};
    final kindName = map['kind'] as String? ?? 'topUp';
    final kind = InvestorTransactionKind.values.firstWhere(
      (k) => k.name == kindName,
      orElse: () => InvestorTransactionKind.topUp,
    );
    final statusName = map['status'] as String? ?? 'pending';
    final status = InvestorTransactionStatus.values.firstWhere(
      (s) => s.name == statusName,
      orElse: () => InvestorTransactionStatus.pending,
    );
    final amount = (map['amountCents'] as num?)?.toInt() ?? 0;
    final fee = (map['feeCents'] as num?)?.toInt() ?? 0;
    return InvestorTransaction(
      id: map['id'] as String? ?? '',
      title: kind.name,
      kind: kind,
      status: status,
      amount: MonetaryAmount(amount, Currency.zar),
      fee: MonetaryAmount(fee, Currency.zar),
      createdAt:
          DateTime.tryParse(map['createdAt'] as String? ?? '') ??
          DateTime.now().toUtc(),
      reference: map['reference'] as String? ?? '',
      projectId: map['projectId'] as String?,
      methodId: map['methodId'] as String?,
    );
  }

  void _watchPaystackDeposit(String transactionId) {
    if (_disposed || !_pendingDepositChecks.add(transactionId)) return;
    unawaited(_pollPaystackDeposit(transactionId));
  }

  Future<void> _pollPaystackDeposit(String transactionId) async {
    const intervals = [
      Duration(seconds: 5),
      Duration(seconds: 10),
      Duration(seconds: 15),
      Duration(seconds: 30),
      Duration(seconds: 60),
      Duration(seconds: 60),
      Duration(seconds: 60),
    ];
    try {
      for (final interval in intervals) {
        await Future<void>.delayed(interval);
        if (_disposed) return;
        final result = await transaction(transactionId);
        if (result case Success(:final value)) {
          if (value.status == InvestorTransactionStatus.successful) {
            _notifyWalletMutation(walletChanged: true);
            return;
          }
          if (value.status == InvestorTransactionStatus.failed) {
            _notifyWalletMutation(walletChanged: false);
            return;
          }
        }
      }
      if (!_disposed) _notifyWalletMutation(walletChanged: false);
    } finally {
      _pendingDepositChecks.remove(transactionId);
    }
  }

  InvestorInvestment _mapInvestment(Object? json) {
    final map = json as Map<String, Object?>? ?? const {};
    final amount = (map['amountCents'] as num?)?.toInt() ?? 0;
    final rate = (map['rateBps'] as num?)?.toInt() ?? 0;
    final term = (map['termMonths'] as num?)?.toInt() ?? 36;
    final principal = MonetaryAmount(amount, Currency.zar);
    final projection = InvestmentProjection(
      principal: principal,
      annualRateBasisPoints: rate,
      termMonths: term,
      payoutEveryMonths: InvestmentPolicy.payoutEveryMonths,
    );
    final statusName = map['status'] as String? ?? 'active';
    return InvestorInvestment(
      id: map['id'] as String? ?? '',
      projectId: map['projectId'] as String? ?? '',
      projectName: map['projectName'] as String? ?? 'Project',
      location: map['town'] as String? ?? '',
      amount: principal,
      earned: MonetaryAmount(0, Currency.zar),
      projectedPayout: projection.payout,
      createdAt:
          DateTime.tryParse(map['createdAt'] as String? ?? '') ??
          DateTime.now().toUtc(),
      status: InvestorInvestmentStatus.values.firstWhere(
        (s) => s.name == statusName,
        orElse: () => InvestorInvestmentStatus.active,
      ),
      progressBasisPoints: 2500,
      imageAsset: AppAssets.investorProjectHero,
      durationMonths: term,
      annualRateBasisPoints: rate,
      principalReturned: !(map['principalHeld'] as bool? ?? true),
    );
  }

  InvestorNotification _mapNotification(Object? json) {
    final map = json as Map<String, Object?>? ?? const {};
    final kindName = map['kind'] as String? ?? 'updates';
    final kind = InvestorNotificationKind.values.firstWhere(
      (k) => k.name == kindName,
      orElse: () => InvestorNotificationKind.newProject,
    );
    return InvestorNotification(
      id: map['id'] as String? ?? '',
      title: map['title'] as String? ?? '',
      message: map['body'] as String? ?? '',
      createdAt:
          DateTime.tryParse(map['createdAt'] as String? ?? '') ??
          DateTime.now().toUtc(),
      destination: InvestorDestination.wallet,
      kind: kind,
      read: map['read'] as bool? ?? false,
    );
  }

  InvestorPaymentMethod _mapMethod(Object? json) {
    final map = json as Map<String, Object?>? ?? const {};
    final kindName = map['kind'] as String? ?? 'bankAccount';
    return InvestorPaymentMethod(
      id: map['id'] as String? ?? '',
      kind: PaymentMethodKind.values.firstWhere(
        (k) => k.name == kindName,
        orElse: () => PaymentMethodKind.bankAccount,
      ),
      name: map['name'] as String? ?? '',
      lastFour: map['lastFour'] as String? ?? '',
      holder: map['holder'] as String? ?? '',
      expiry: map['expiry'] as String? ?? '',
      bankType: map['bankType'] as String? ?? '',
      branchCode: map['branchCode'] as String? ?? '',
      reusable: map['reusable'] as bool? ?? true,
      isDefault: map['isDefault'] as bool? ?? false,
    );
  }

  InvestorAccountSnapshot _mapSnapshot(Object? json) {
    final map = json as Map<String, Object?>? ?? const {};
    final available = (map['availableCents'] as num?)?.toInt() ?? 0;
    _cardPaymentsEnabled = map['cardPaymentsEnabled'] == true;
    _manualEftEnabled = map['manualEftEnabled'] == true;
    final verificationName =
        map['verificationStatus'] as String? ?? 'incomplete';
    return InvestorAccountSnapshot(
      balances: {Currency.zar: available},
      investments: ((map['investments'] as List<dynamic>?) ?? const [])
          .map(_mapInvestment)
          .toList(),
      transactions: ((map['transactions'] as List<dynamic>?) ?? const [])
          .map(_mapTx)
          .toList(),
      notifications: ((map['notifications'] as List<dynamic>?) ?? const [])
          .map(_mapNotification)
          .toList(),
      paymentMethods: [
        ...((map['paymentMethods'] as List<dynamic>?) ?? const []).map(
          _mapMethod,
        ),
        if (_cardPaymentsEnabled) InvestorDepositAccount.paystackMethod,
      ],
      verification: VerificationStatus.values.firstWhere(
        (v) => v.name == verificationName,
        orElse: () => VerificationStatus.incomplete,
      ),
      asOf: DateTime.now().toUtc(),
      balanceVisible: _balanceVisible,
    );
  }

  InvestorAccountSummary _mapBalance(Object? json) {
    final map = json as Map<String, Object?>?;
    if (map == null) {
      throw const FormatException('Invalid wallet balance response.');
    }
    int readCents(String key) {
      final value = map[key];
      if (value is! num || !value.isFinite || value < 0) {
        throw FormatException('Invalid $key in wallet balance response.');
      }
      final cents = value.toInt();
      if (cents != value) {
        throw FormatException('Invalid $key in wallet balance response.');
      }
      return cents;
    }

    final verificationName = map['verificationStatus'] as String?;
    return InvestorAccountSummary(
      available: MonetaryAmount(
        readCents('availableCents'),
        InvestmentPolicy.currency,
      ),
      investedCapital: MonetaryAmount(
        readCents('heldPrincipalCents'),
        InvestmentPolicy.currency,
      ),
      verification: VerificationStatus.values.firstWhere(
        (status) => status.name == verificationName,
        orElse: () => VerificationStatus.incomplete,
      ),
    );
  }

  @override
  Future<Result<InvestorAccountSummary>> balance() async {
    final result = await _client.request(
      path: '/v1/wallet/balance',
      query: {'entity': _entity},
      decode: _mapBalance,
    );
    if (result case Failure<InvestorAccountSummary>(
      :final error,
    ) when error.statusCode == 404) {
      final snapshotResult = await snapshot();
      return switch (snapshotResult) {
        Success<InvestorAccountSnapshot>(:final value) => Success(
          InvestorAccountSummary.from(value),
        ),
        Failure<InvestorAccountSnapshot>(:final error) => Failure(error),
      };
    }
    return result;
  }

  @override
  Future<Result<InvestorAccountSnapshot>> snapshot() async {
    final result = await _client.request(
      path: '/v1/wallet/snapshot',
      query: {'entity': _entity},
      decode: _mapSnapshot,
    );
    if (result case Success(:final value)) {
      _snapshot = value;
    }
    return result;
  }

  @override
  Future<Result<InvestorTransaction>> transaction(String id) {
    return _client.request(
      path: '/v1/wallet/transactions/$id',
      query: {'entity': _entity},
      decode: _mapTx,
    );
  }

  @override
  Future<Result<InvestorInvestment>> investment(String id) {
    return _client.request(
      path: '/v1/wallet/investments/$id',
      query: {'entity': _entity},
      decode: _mapInvestment,
    );
  }

  @override
  Future<Result<InvestorNotification>> notification(String id) async {
    var snap = _snapshot;
    if (snap == null) {
      final result = await snapshot();
      if (result case Success<InvestorAccountSnapshot>(:final value)) {
        snap = value;
      }
    }
    final found = snap?.notifications.where((n) => n.id == id).firstOrNull;
    if (found == null) {
      return const Failure(
        AppFailure(FailureKind.notFound, 'Notification not found.'),
      );
    }
    return Success(found);
  }

  @override
  Future<Result<void>> markNotificationsRead([String? id]) {
    return _client.request(
      path: '/v1/wallet/notifications/read',
      method: 'POST',
      data: {'id': id},
      decode: (_) {},
    );
  }

  @override
  String newOperationId() =>
      '${_context.entity.name}-operation-${DateTime.now().microsecondsSinceEpoch}-${++_sequence}';

  InvestorOperationReceipt _mapReceipt(Object? json) {
    final map = json as Map<String, Object?>? ?? const {};
    final statusName = map['status'] as String? ?? 'pending';
    final status = InvestorTransactionStatus.values.firstWhere(
      (value) => value.name == statusName,
      orElse: () => InvestorTransactionStatus.pending,
    );
    final rawInstructions = map['instructions'];
    final instructions = rawInstructions is Map
        ? Map<String, Object?>.from(rawInstructions)
        : null;
    final rawCheckoutUrl = map['checkoutUrl'];
    String? checkoutUrl;
    if (rawCheckoutUrl != null) {
      if (rawCheckoutUrl is! String) {
        throw const FormatException('Invalid Paystack checkout URL.');
      }
      final checkout = Uri.tryParse(rawCheckoutUrl);
      if (checkout == null ||
          checkout.scheme != 'https' ||
          checkout.host != 'checkout.paystack.com') {
        throw const FormatException('Invalid Paystack checkout URL.');
      }
      checkoutUrl = checkout.toString();
    }
    return InvestorOperationReceipt(
      transactionId:
          map['id'] as String? ??
          map['transactionId'] as String? ??
          map['receiptId'] as String? ??
          '',
      investmentId: map['investmentId'] as String?,
      status: status,
      paymentInstructions: instructions == null
          ? null
          : InvestorPaymentInstructions(
              bank: instructions['bank'] as String? ?? '',
              accountName: instructions['accountName'] as String? ?? '',
              accountNumber: instructions['accountNumber'] as String? ?? '',
              branchCode: instructions['branchCode'] as String? ?? '',
              reference: instructions['reference'] as String? ?? '',
              amountCents: int.tryParse('${instructions['amountCents']}') ?? 0,
              note: instructions['note'] as String? ?? '',
            ),
      checkoutUrl: checkoutUrl,
    );
  }

  void _notifyWalletMutation({required bool walletChanged}) {
    _snapshot = null;
    _changes.add(
      InvestorAccountChange({
        InvestorDataKind.transactions,
        if (walletChanged) InvestorDataKind.wallet,
      }),
    );
  }

  @override
  Future<Result<InvestorOperationReceipt>> invest({
    required InvestorProject project,
    required MonetaryAmount amount,
    required String operationId,
    required String pin,
    InvestmentProjection? quote,
    bool simulateBiometric = false,
  }) async {
    final quoteResult = await _client.request<Object?>(
      path: '/v1/investments/quotes',
      method: 'POST',
      data: {
        'projectId': project.id,
        'amountCents': amount.minorUnits,
        'entity': _entity,
      },
      decode: (json) => json,
    );
    if (quoteResult case Failure(:final error)) {
      return Failure(error);
    }
    final quoteResponse = (quoteResult as Success<Object?>).value;
    if (quoteResponse is! Map || quoteResponse['id'] is! String) {
      return const Failure(
        AppFailure(
          FailureKind.server,
          'The investment quote response was incomplete. Please try again.',
        ),
      );
    }
    final quoteId = (quoteResponse['id'] as String).trim();
    if (quoteId.isEmpty) {
      return const Failure(
        AppFailure(
          FailureKind.server,
          'The investment quote response was incomplete. Please try again.',
        ),
      );
    }
    final result = await _client.request<Object?>(
      path: '/v1/investments',
      method: 'POST',
      data: {
        'projectId': project.id,
        'amountCents': amount.minorUnits,
        'operationId': operationId,
        'pin': pin,
        'quoteId': quoteId,
        'entity': _entity,
      },
      decode: (json) => json,
    );
    if (result case Success(:final value)) {
      final receipt = _mapReceipt(value);
      if (receipt.transactionId.isEmpty) {
        return const Failure(
          AppFailure(
            FailureKind.server,
            'The investment confirmation response was incomplete.',
          ),
        );
      }
      _notifyWalletMutation(walletChanged: true);
      return Success(receipt);
    }
    return result as Failure<InvestorOperationReceipt>;
  }

  @override
  Future<Result<InvestorOperationReceipt>> addMoney({
    required MonetaryAmount amount,
    required String methodId,
    required String operationId,
    required String pin,
    bool simulateBiometric = false,
  }) async {
    final result = await _client.request<Object?>(
      path: '/v1/wallet/add-money',
      method: 'POST',
      data: {
        'amountCents': amount.minorUnits,
        'methodId': methodId,
        'operationId': operationId,
        'pin': pin,
        'entity': _entity,
      },
      decode: (json) => json,
    );
    if (result case Success(:final value)) {
      final receipt = _mapReceipt(value);
      if (receipt.transactionId.isEmpty) {
        return const Failure(
          AppFailure(
            FailureKind.server,
            'The deposit response was incomplete.',
          ),
        );
      }
      _notifyWalletMutation(
        walletChanged: receipt.status == InvestorTransactionStatus.successful,
      );
      if (receipt.checkoutUrl != null &&
          receipt.status == InvestorTransactionStatus.pending) {
        _watchPaystackDeposit(receipt.transactionId);
      }
      return Success(receipt);
    }
    return result as Failure<InvestorOperationReceipt>;
  }

  @override
  Future<Result<InvestorOperationReceipt>> withdraw({
    required MonetaryAmount amount,
    required String methodId,
    required String operationId,
    required String pin,
    bool simulateBiometric = false,
  }) async {
    final result = await _client.request<Object?>(
      path: '/v1/wallet/withdraw',
      method: 'POST',
      data: {
        'amountCents': amount.minorUnits,
        'methodId': methodId,
        'operationId': operationId,
        'pin': pin,
        'entity': _entity,
      },
      decode: (json) => json,
    );
    if (result case Success(:final value)) {
      final receipt = _mapReceipt(value);
      if (receipt.transactionId.isEmpty) {
        return const Failure(
          AppFailure(
            FailureKind.server,
            'The withdrawal response was incomplete.',
          ),
        );
      }
      _notifyWalletMutation(walletChanged: true);
      return Success(receipt);
    }
    return result as Failure<InvestorOperationReceipt>;
  }

  @override
  Future<Result<InvestorPaymentMethod>> addCard({
    required String cardNumber,
    required String holder,
    required String expiry,
    required String securityCode,
    bool reusable = true,
  }) async {
    return const Failure(
      AppFailure(
        FailureKind.configuration,
        'Card payments are not enabled. Use manual EFT with a bank account.',
      ),
    );
  }

  @override
  Future<Result<InvestorPaymentMethod>> addBankAccount({
    required String bank,
    required String accountNumber,
    required String accountType,
    required String branchCode,
    required String holder,
  }) {
    return _client.request(
      path: '/v1/wallet/payment-methods/bank',
      method: 'POST',
      data: {
        'bank': bank,
        'accountNumber': accountNumber,
        'accountType': accountType,
        'branchCode': branchCode,
        'holder': holder,
        'entity': _entity,
      },
      decode: _mapMethod,
    );
  }

  @override
  Future<Result<void>> removePaymentMethod(String id) {
    return _client.request(
      path: '/v1/wallet/payment-methods/$id',
      method: 'DELETE',
      query: {'entity': _entity},
      decode: (_) {},
    );
  }

  @override
  Future<Result<void>> setDefaultPaymentMethod(String id, bool isDefault) {
    return _client.request(
      path: '/v1/wallet/payment-methods/$id/default',
      method: 'PATCH',
      data: {'isDefault': isDefault, 'entity': _entity},
      decode: (_) {},
    );
  }

  @override
  void setVerification(VerificationStatus status, {EntityType? entity}) {
    _changes.add(const InvestorAccountChange({InvestorDataKind.verification}));
  }

  @override
  void dispose() {
    _disposed = true;
    _changes.close();
  }
}
