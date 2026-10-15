import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type PaystackDeposit = {
  reference: string;
  status: string;
  amountCents: number;
  currency: string;
  transactionId?: string;
  entityId?: string;
};

@Injectable()
export class PaystackPaymentProvider {
  constructor(private readonly config: ConfigService) {}

  private get secretKey(): string {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY')?.trim();
    if (!secret?.startsWith('sk_test_')) {
      throw new ServiceUnavailableException(
        'Paystack test mode requires a PAYSTACK_SECRET_KEY beginning with sk_test_.',
      );
    }
    return secret;
  }

  private get callbackUrl(): string {
    const configured = this.config.get<string>('PAYSTACK_CALLBACK_URL')?.trim();
    const publicUrl = this.config.get<string>('API_PUBLIC_URL')?.trim();
    const value =
      configured ||
      (publicUrl
        ? new URL('/v1/wallet/paystack/callback', publicUrl).toString()
        : '');
    if (!value) {
      throw new ServiceUnavailableException(
        'Configure PAYSTACK_CALLBACK_URL or API_PUBLIC_URL before accepting card payments.',
      );
    }
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') throw new Error();
      return url.toString();
    } catch {
      throw new ServiceUnavailableException(
        'PAYSTACK_CALLBACK_URL must be a valid HTTPS URL.',
      );
    }
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`https://api.paystack.co${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(15000),
    });
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new ServiceUnavailableException(
        'Paystack returned an invalid response. Please try again.',
      );
    }
    if (
      !response.ok ||
      typeof result !== 'object' ||
      result === null ||
      !('status' in result) ||
      result.status !== true ||
      !('data' in result) ||
      typeof result.data !== 'object' ||
      result.data === null
    ) {
      throw new ServiceUnavailableException(
        'Paystack could not process the payment request.',
      );
    }
    return result.data as Record<string, unknown>;
  }

  async initiateDeposit(input: {
    amountCents: bigint;
    reference: string;
    entityId: string;
    transactionId: string;
    email: string;
  }): Promise<{ status: 'pending'; checkoutUrl: string }> {
    const email = input.email.trim();
    if (!email) {
      throw new ServiceUnavailableException(
        'A verified account email is required to start card checkout.',
      );
    }
    const amount = Number(input.amountCents);
    if (!Number.isSafeInteger(amount) || amount < 100) {
      throw new ServiceUnavailableException(
        'The card payment amount is outside the supported range.',
      );
    }
    const data = await this.request('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email,
        amount,
        currency: 'ZAR',
        reference: input.reference,
        callback_url: this.callbackUrl,
        metadata: {
          transactionId: input.transactionId,
          entityId: input.entityId,
        },
      }),
    });
    const checkoutUrl = data.authorization_url;
    if (typeof checkoutUrl !== 'string') {
      throw new ServiceUnavailableException(
        'Paystack did not provide a secure checkout URL.',
      );
    }
    let checkout: URL;
    try {
      checkout = new URL(checkoutUrl);
    } catch {
      throw new ServiceUnavailableException(
        'Paystack returned an invalid checkout URL.',
      );
    }
    if (
      checkout.protocol !== 'https:' ||
      checkout.hostname !== 'checkout.paystack.com'
    ) {
      throw new ServiceUnavailableException(
        'Paystack returned an untrusted checkout URL.',
      );
    }
    return { status: 'pending', checkoutUrl: checkout.toString() };
  }

  async verifyTransaction(reference: string): Promise<PaystackDeposit> {
    const data = await this.request(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      { method: 'GET' },
    );
    const metadata = data.metadata;
    const amountCents = data.amount;
    if (
      typeof data.reference !== 'string' ||
      typeof data.status !== 'string' ||
      typeof amountCents !== 'number' ||
      !Number.isSafeInteger(amountCents) ||
      typeof data.currency !== 'string'
    ) {
      throw new ServiceUnavailableException(
        'Paystack returned incomplete payment verification details.',
      );
    }
    return {
      reference: data.reference,
      status: data.status,
      amountCents,
      currency: data.currency,
      transactionId:
        typeof metadata === 'object' &&
        metadata !== null &&
        'transactionId' in metadata &&
        typeof metadata.transactionId === 'string'
          ? metadata.transactionId
          : undefined,
      entityId:
        typeof metadata === 'object' &&
        metadata !== null &&
        'entityId' in metadata &&
        typeof metadata.entityId === 'string'
          ? metadata.entityId
          : undefined,
    };
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): void {
    if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) {
      throw new UnauthorizedException('Invalid Paystack webhook signature.');
    }
    const expected = createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest();
    const received = Buffer.from(signature, 'hex');
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException('Invalid Paystack webhook signature.');
    }
  }
}
