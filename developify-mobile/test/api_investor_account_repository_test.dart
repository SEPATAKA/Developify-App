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
import 'package:developify_mobile/features/investor/domain/investor_account.dart';
import 'package:developify_mobile/features/investor/domain/investor_account_context.dart';

class PaymentAdapter implements HttpClientAdapter {
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final response = options.uri.path.endsWith('/wallet/add-money')
        ? {
            'id': 'deposit-1',
            'status': 'pending',
            'instructions': {
              'bank': 'Developify Holdings',
              'accountNumber': '6284190219',
              'branchCode': '250655',
              'reference': 'INV-1234',
              'amountCents': '25000',
              'note': 'Transfer using the reference.',
            },
          }
        : {
            'availableCents': 0,
            'verificationStatus': 'verified',
            'investments': <Object>[],
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

  test(
    'Manual EFT response retains pending status and transfer instructions',
    () async {
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
      expect(
        adapter.requests.map((request) => request.uri.path),
        containsAll(['/v1/wallet/add-money', '/v1/wallet/snapshot']),
      );
    },
  );

  test(
    'Live card setup is unavailable without transmitting card details',
    () async {
      expect(repository.supportedPaymentMethods, {
        PaymentMethodKind.bankAccount,
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
      expect(adapter.requests, isEmpty);
    },
  );
}
