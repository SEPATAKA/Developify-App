jest.mock('@nestjs/config', () => ({
  ConfigService: class {
    constructor(private readonly values: Record<string, string>) {}

    get(key: string) {
      return this.values[key];
    }
  },
}));

import { createHmac } from 'node:crypto';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaystackPaymentProvider } from './paystack-payment.provider';

describe('PaystackPaymentProvider', () => {
  const secretKey = 'sk_test_example';
  const reference = 'INV-1234';
  const transactionId = 'deposit-123';
  const entityId = 'investor-123';
  let provider: PaystackPaymentProvider;

  beforeEach(() => {
    provider = new PaystackPaymentProvider(
      new ConfigService({
        PAYSTACK_SECRET_KEY: secretKey,
        PAYSTACK_CALLBACK_URL:
          'https://api.example.test/v1/wallet/paystack/callback',
      }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('initializes a hosted checkout using a test key and ZAR minor units', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            authorization_url: 'https://checkout.paystack.com/session',
          },
        }),
        { status: 200 },
      ),
    );

    await expect(
      provider.initiateDeposit({
        amountCents: 25000n,
        reference,
        transactionId,
        entityId,
        email: 'investor@example.test',
      }),
    ).resolves.toEqual({
      status: 'pending',
      checkoutUrl: 'https://checkout.paystack.com/session',
    });

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://api.paystack.co/transaction/initialize');
    expect(JSON.parse(String(options?.body))).toEqual({
      email: 'investor@example.test',
      amount: 25000,
      currency: 'ZAR',
      reference,
      callback_url: 'https://api.example.test/v1/wallet/paystack/callback',
      metadata: { transactionId, entityId },
    });
    expect(new Headers(options?.headers).get('authorization')).toBe(
      `Bearer ${secretKey}`,
    );
  });

  it('requires test credentials and a trusted Paystack checkout host', async () => {
    const config = new ConfigService({
      PAYSTACK_SECRET_KEY: 'sk_live_not_allowed',
      PAYSTACK_CALLBACK_URL:
        'https://api.example.test/v1/wallet/paystack/callback',
    });
    const liveKeyProvider = new PaystackPaymentProvider(config);
    const fetch = jest.spyOn(globalThis, 'fetch');

    await expect(
      liveKeyProvider.initiateDeposit({
        amountCents: 100n,
        reference,
        transactionId,
        entityId,
        email: 'investor@example.test',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetch).not.toHaveBeenCalled();

    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: { authorization_url: 'https://evil.example/checkout' },
        }),
        { status: 200 },
      ),
    );
    await expect(
      provider.initiateDeposit({
        amountCents: 100n,
        reference,
        transactionId,
        entityId,
        email: 'investor@example.test',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('verifies the transaction against Paystack server-side', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            reference,
            status: 'success',
            amount: 25000,
            currency: 'ZAR',
            metadata: { transactionId, entityId },
          },
        }),
        { status: 200 },
      ),
    );

    await expect(provider.verifyTransaction(reference)).resolves.toEqual({
      reference,
      status: 'success',
      amountCents: 25000,
      currency: 'ZAR',
      transactionId,
      entityId,
    });
  });

  it('accepts only an authentic Paystack webhook signature', () => {
    const body = Buffer.from('{"event":"charge.success"}');
    const signature = createHmac('sha512', secretKey)
      .update(body)
      .digest('hex');

    expect(() =>
      provider.verifyWebhookSignature(body, signature),
    ).not.toThrow();
    expect(() =>
      provider.verifyWebhookSignature(body, '0'.repeat(128)),
    ).toThrow(UnauthorizedException);
  });
});
