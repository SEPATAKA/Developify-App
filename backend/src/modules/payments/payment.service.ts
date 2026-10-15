import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaystackPaymentProvider } from './paystack-payment.provider';

export const PAYSTACK_CARD_METHOD_ID = 'paystack-card-checkout';

/** Phase-1 manual EFT payment provider. Swap for Paystack later. */
export interface PaymentProvider {
  readonly name: string;
  initiateDeposit(input: {
    amountCents: bigint;
    reference: string;
    entityId: string;
    transactionId: string;
    email: string;
  }): Promise<{
    status: 'pending';
    instructions?: Record<string, string>;
    checkoutUrl?: string;
  }>;
  initiateWithdrawal(input: {
    amountCents: bigint;
    reference: string;
    methodId: string;
  }): Promise<{ status: 'pending' }>;
}

@Injectable()
export class ManualPaymentProvider implements PaymentProvider {
  readonly name = 'manual';

  async initiateDeposit(input: {
    amountCents: bigint;
    reference: string;
    entityId: string;
    transactionId: string;
    email: string;
  }) {
    return {
      status: 'pending' as const,
      instructions: {
        bank: 'Developify Holdings',
        accountNumber: '6284190219',
        branchCode: '250655',
        reference: input.reference,
        amountCents: String(input.amountCents),
        note: 'Upload proof or wait for admin confirmation.',
      },
    };
  }

  async initiateWithdrawal(_input: {
    amountCents: bigint;
    reference: string;
    methodId: string;
  }) {
    return { status: 'pending' as const };
  }
}

@Injectable()
export class PaymentService {
  constructor(
    private readonly config: ConfigService,
    private readonly manual: ManualPaymentProvider,
    private readonly paystack: PaystackPaymentProvider,
  ) {}

  get active(): PaymentProvider {
    switch (this.config.get<string>('PAYMENT_PROVIDER', 'manual')) {
      case 'manual':
        return this.manual;
      case 'paystack':
        return {
          name: 'paystack',
          initiateDeposit: (input) => this.paystack.initiateDeposit(input),
          initiateWithdrawal: (input) => this.manual.initiateWithdrawal(input),
        };
      default:
        throw new ServiceUnavailableException(
          'PAYMENT_PROVIDER must be set to manual or paystack.',
        );
    }
  }

  get cardPaymentsEnabled(): boolean {
    return this.active.name === 'paystack';
  }

  get manualProvider(): ManualPaymentProvider {
    return this.manual;
  }

  get paystackTestProvider(): PaystackPaymentProvider {
    if (!this.cardPaymentsEnabled) {
      throw new ServiceUnavailableException(
        'Paystack card payments are not enabled.',
      );
    }
    return this.paystack;
  }
}
