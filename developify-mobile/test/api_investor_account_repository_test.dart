import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:developify_mobile/app/environment/app_environment.dart';
import 'package:developify_mobile/core/errors/result.dart';
import 'package:developify_mobile/core/models/monetary_amount.dart';
import 'package:developify_mobile/core/network/api_client.dart';
import 'package:developify_mobile/core/storage/token_storage.dart';
import 'package:developify_mobile/core/services/session_service.dart';
import 'package:developify_mobile/features/investor/data/api_investor_account_repository.dart';
import 'package:developify_mobile/features/investor/domain/account_summary.dart';
import 'package:developify_mobile/features/investor/domain/investor_account.dart';
import 'package:developify_mobile/features/investor/domain/investor_account_context.dart';

class PaymentAdapter implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  int balanceStatusCode = 200;
  int snapshotBalanceCents = 0;
  List<Object> snapshotInvestments = const [];
  String transactionStatus = 'pending';
  bool cardPaymentsEnabled = true;
  bool manualEftEnabled = true;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final isCardCheckout =
        options.uri.path.endsWith('/wallet/add-money') &&
        options.data is Map &&
        (options.data as Map)['methodId'] == 'paystack-card-checkout';
    if (options.uri.path.endsWith('/wallet/balance') &&
        balanceStatusCode != 200) {
      return ResponseBody.fromString(
        '{"message":"Wallet balance route not found"}',
        balanceStatusCode,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      );
    }
    final response = isCardCheckout
        ? {
            'id': 'deposit-card-1',
            'status': 'pending',
            'checkoutUrl': 'https://checkout.paystack.com/session',
          }
        : options.uri.path.endsWith('/wallet/add-money')
        ? {
            'id': 'deposit-1',
            'status': 'pending',
            'instructions': {
              'bank': 'Developify Holdings',
              'accountName': 'Developify Merchant',
              'accountNumber': '6284190219',
              'branchCode': '250655',
              'reference': 'INV-1234',
              'amountCents': '25000',
              'note': 'Transfer using the reference.',
            },
          }
        : options.uri.path.endsWith('/wallet/withdraw')
        ? {'id': 'withdrawal-1', 'status': 'pending'}
        : options.uri.path.contains('/wallet/transactions/')
        ? {
            'id': 'deposit-card-1',
            'kind': 'topUp',
            'status': transactionStatus,
            'amountCents': 25000,
            'createdAt': '2026-10-15T00:00:00.000Z',
          }
        : options.uri.path.endsWith('/wallet/balance')
        ? {
            'availableCents': 50000,
            'heldPrincipalCents': 300000,
            'verificationStatus': 'verified',
          }
        : {
            'availableCents': snapshotBalanceCents,
            'verificationStatus': 'verified',
            'cardPaymentsEnabled': cardPaymentsEnabled,
            'manualEftEnabled': manualEftEnabled,
            'investments': snapshotInvestments,
            'transactions': <Object>[],
            'notifications': <Object>[],
            'paymentMethods': <Object>[],
          };
    return ResponseBody.fromString(
      jsonEncode(response),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  late PaymentAdapter adapter;
  late ApiClient client;
  late InvestorAccountContext context;
  late ApiInvestorAccountRepository repository;

  setUp(() {
    adapter = PaymentAdapter();
    final dio = Dio()..httpClientAdapter = adapter;
    client = ApiClient(
      environment: const AppEnvironment(
        apiBaseUrl: 'https://api.example.test',
        mockMode: false,
      ),
      tokens: MemoryTokenStorage(),
      dio: dio,
    );
    context = InvestorAccountContext(SessionService());
    repository = ApiInvestorAccountRepository(client, context);
  });

  tearDown(() {
    repository.dispose();
    context.dispose();
    client.dispose();
  });

  test('Loading a snapshot does not announce a wallet mutation', () async {
    final changes = <InvestorAccountChange>[];
    final subscription = repository.changes.listen(changes.add);
    addTearDown(subscription.cancel);

    final result = await repository.snapshot();
    await Future<void>.delayed(Duration.zero);

    expect(result, isA<Success<InvestorAccountSnapshot>>());
    expect(changes, isEmpty);
  });

  test('Balance uses the lightweight live wallet endpoint', () async {
    final result = await repository.balance();

    expect(result, isA<Success<InvestorAccountSummary>>());
    final summary = (result as Success<InvestorAccountSummary>).value;
    expect(summary.available, const MonetaryAmount(50000, Currency.zar));
    expect(summary.investedCapital, const MonetaryAmount(300000, Currency.zar));
    expect(summary.overallBalance, const MonetaryAmount(350000, Currency.zar));
    expect(adapter.requests.map((request) => request.uri.path), [
      '/v1/wallet/balance',
    ]);
  });

  test(
    'Balance falls back to the snapshot when the endpoint is missing',
    () async {
      adapter.balanceStatusCode = 404;
      adapter.snapshotBalanceCents = 50000;
      adapter.snapshotInvestments = [
        {
          'id': 'investment-1',
          'projectId': 'project-1',
          'projectName': 'Savannah Estate',
          'amountCents': 300000,
          'rateBps': 1280,
          'termMonths': 36,
          'status': 'active',
          'principalHeld': true,
          'createdAt': '2026-01-01T00:00:00.000Z',
        },
      ];

      final result = await repository.balance();

      expect(result, isA<Success<InvestorAccountSummary>>());
      final summary = (result as Success<InvestorAccountSummary>).value;
      expect(summary.available, const MonetaryAmount(50000, Currency.zar));
      expect(
        summary.investedCapital,
        const MonetaryAmount(300000, Currency.zar),
      );
      expect(
        summary.overallBalance,
        const MonetaryAmount(350000, Currency.zar),
      );
      expect(adapter.requests.map((request) => request.uri.path), [
        '/v1/wallet/balance',
        '/v1/wallet/snapshot',
      ]);
    },
  );

  test(
    'Balance does not hide non-404 endpoint failures with a snapshot',
    () async {
      adapter.balanceStatusCode = 500;

      final result = await repository.balance();

      expect(result, isA<Failure<InvestorAccountSummary>>());
      expect(adapter.requests.map((request) => request.uri.path), [
        '/v1/wallet/balance',
      ]);
    },
  );

  test(
    'Manual EFT response retains pending status and transfer instructions',
    () async {
      final changes = repository.changes.first;
      final result = await repository.addMoney(
        amount: const MonetaryAmount(25000, Currency.zar),
        methodId: 'bank-method-1',
        operationId: 'deposit-operation-1',
        pin: '1234',
      );

      expect(result, isA<Success<InvestorOperationReceipt>>());
      final receipt = (result as Success<InvestorOperationReceipt>).value;
      expect(receipt.transactionId, 'deposit-1');
      expect(receipt.status, InvestorTransactionStatus.pending);
      expect(receipt.paymentInstructions?.reference, 'INV-1234');
      expect(receipt.paymentInstructions?.amountCents, 25000);
      expect(receipt.paymentInstructions?.accountName, 'Developify Merchant');
      expect((await changes).kinds, {InvestorDataKind.transactions});
      expect(adapter.requests.map((request) => request.uri.path), [
        '/v1/wallet/add-money',
      ]);
    },
  );

  test('Paystack checkout never sends card details to the API', () async {
    final changes = repository.changes.first;
    final result = await repository.addMoney(
      amount: const MonetaryAmount(25000, Currency.zar),
      methodId: 'paystack-card-checkout',
      operationId: 'paystack-card-operation-1',
      pin: '1234',
    );

    expect(result, isA<Success<InvestorOperationReceipt>>());
    final receipt = (result as Success<InvestorOperationReceipt>).value;
    expect(receipt.status, InvestorTransactionStatus.pending);
    expect(receipt.checkoutUrl, 'https://checkout.paystack.com/session');
    expect((await changes).kinds, {InvestorDataKind.transactions});
    final request = adapter.requests.single;
    expect(request.uri.path, '/v1/wallet/add-money');
    expect(request.data, isA<Map>());
    expect((request.data as Map).keys, isNot(contains('cardNumber')));
    expect((request.data as Map).keys, isNot(contains('securityCode')));
  });

  test('Confirmed Paystack deposit refreshes the wallet balance', () async {
    adapter.transactionStatus = 'successful';
    final events = <InvestorAccountChange>[];
    final subscription = repository.changes.listen(events.add);
    addTearDown(subscription.cancel);

    final result = await repository.addMoney(
      amount: const MonetaryAmount(25000, Currency.zar),
      methodId: 'paystack-card-checkout',
      operationId: 'paystack-confirmed-operation-1',
      pin: '1234',
    );

    expect(result, isA<Success<InvestorOperationReceipt>>());
    await expectLater(
      repository.changes
          .where((event) => event.kinds.contains(InvestorDataKind.wallet))
          .first
          .timeout(const Duration(seconds: 7)),
      completion(
        isA<InvestorAccountChange>().having(
          (event) => event.kinds,
          'kinds',
          contains(InvestorDataKind.wallet),
        ),
      ),
    );
    expect(
      adapter.requests.any(
        (request) =>
            request.uri.path == '/v1/wallet/transactions/deposit-card-1',
      ),
      isTrue,
    );
    expect(
      events.any((event) => event.kinds.contains(InvestorDataKind.wallet)),
      isTrue,
    );
  });

  test(
    'Withdrawal acceptance refreshes the available wallet balance',
    () async {
      final changes = repository.changes.first;
      final result = await repository.withdraw(
        amount: const MonetaryAmount(25000, Currency.zar),
        methodId: 'bank-method-1',
        operationId: 'withdraw-operation-1',
        pin: '1234',
      );

      expect(result, isA<Success<InvestorOperationReceipt>>());
      expect((await changes).kinds, {
        InvestorDataKind.wallet,
        InvestorDataKind.transactions,
      });
      expect(adapter.requests.map((request) => request.uri.path), [
        '/v1/wallet/withdraw',
      ]);
    },
  );

  test(
    'Snapshot exposes Paystack hosted checkout without a stored card',
    () async {
      final result = await repository.snapshot();

      expect(result, isA<Success<InvestorAccountSnapshot>>());
      expect(repository.supportedPaymentMethods, {
        PaymentMethodKind.bankAccount,
        PaymentMethodKind.card,
      });
      expect(repository.usesLivePayments, isTrue);
      expect(repository.supportsManualEft, isTrue);
      final snapshot = (result as Success<InvestorAccountSnapshot>).value;
      expect(
        snapshot.paymentMethods,
        contains(InvestorDepositAccount.paystackMethod),
      );
    },
  );

  test(
    'Live card setup is unavailable without transmitting card details',
    () async {
      await repository.snapshot();

      expect(repository.supportedPaymentMethods, {
        PaymentMethodKind.bankAccount,
        PaymentMethodKind.card,
      });
      expect(repository.supportsManualEft, isTrue);
      expect(repository.allowsDemoBiometricAuthorization, isFalse);

      final result = await repository.addCard(
        cardNumber: '4111111111111111',
        holder: 'Test User',
        expiry: '12/30',
        securityCode: '123',
      );

      expect(result, isA<Failure<InvestorPaymentMethod>>());
      expect(adapter.requests, hasLength(1));
      expect(adapter.requests.single.data, isNull);
    },
  );

  test(
    'live deposits are unavailable when neither provider is configured',
    () async {
      adapter.cardPaymentsEnabled = false;
      adapter.manualEftEnabled = false;

      await repository.snapshot();

      expect(repository.supportedPaymentMethods, isEmpty);
      expect(repository.usesLivePayments, isTrue);
      expect(repository.supportsManualEft, isFalse);
    },
  );
}
