jest.mock('@nestjs/config', () => ({
  ConfigService: class {
    constructor(private readonly values: Record<string, string>) {}

    get(key: string) {
      return this.values[key];
    }
  },
}));

import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ManualPaymentProvider, PaymentService } from './payment.service';
import { PaystackPaymentProvider } from './paystack-payment.provider';

describe('PaymentService deposit availability', () => {
  const bankDetails = {
    DEPOSIT_BANK_NAME: 'Settlement Bank',
    DEPOSIT_BANK_ACCOUNT_NAME: 'Developify Merchant',
    DEPOSIT_BANK_ACCOUNT_NUMBER: '1234567890',
    DEPOSIT_BANK_BRANCH_CODE: '123456',
  };

  it('does not expose or return a fake manual settlement account', async () => {
    const provider = new ManualPaymentProvider(new ConfigService({}));

    expect(provider.isConfigured).toBe(false);
    await expect(
      provider.initiateDeposit({
        amountCents: 1000n,
        reference: 'DEP-1234',
        entityId: 'entity-1',
        transactionId: 'transaction-1',
        email: 'investor@example.test',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('returns only the configured settlement account details', async () => {
    const provider = new ManualPaymentProvider(new ConfigService(bankDetails));

    expect(provider.isConfigured).toBe(true);
    await expect(
      provider.initiateDeposit({
        amountCents: 1000n,
        reference: 'DEP-1234',
        entityId: 'entity-1',
        transactionId: 'transaction-1',
        email: 'investor@example.test',
      }),
    ).resolves.toMatchObject({
      instructions: {
        bank: 'Settlement Bank',
        accountName: 'Developify Merchant',
        accountNumber: '1234567890',
        branchCode: '123456',
        reference: 'DEP-1234',
      },
    });
  });

  it('enables only configured manual or sandbox card deposit methods', () => {
    const manualConfig = new ConfigService({
      PAYMENT_PROVIDER: 'manual',
      ...bankDetails,
    });
    const manual = new ManualPaymentProvider(manualConfig);
    const manualPaystack = new PaystackPaymentProvider(manualConfig);
    const manualService = new PaymentService(
      manualConfig,
      manual,
      manualPaystack,
    );
    expect(manualService.manualEftEnabled).toBe(true);
    expect(manualService.cardPaymentsEnabled).toBe(false);

    const paystackConfig = new ConfigService({
      PAYMENT_PROVIDER: 'paystack',
      PAYSTACK_SECRET_KEY: 'sk_test_example',
      PAYSTACK_CALLBACK_URL: 'https://api.example.test/callback',
    });
    const paystack = new PaystackPaymentProvider(paystackConfig);
    const paystackService = new PaymentService(
      paystackConfig,
      new ManualPaymentProvider(paystackConfig),
      paystack,
    );
    expect(paystackService.manualEftEnabled).toBe(false);
    expect(paystackService.cardPaymentsEnabled).toBe(true);
  });
});
