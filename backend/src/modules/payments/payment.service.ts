import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaystackPaymentProvider } from './paystack-payment.provider';

export const PAYSTACK_CARD_METHOD_ID = 'paystack-card-checkout';

/** Manual EFT provider with administrator-confirmed settlement. */
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

  constructor(private readonly config: ConfigService) {}

  private get depositAccount() {
    const bank = this.config.get<string>('DEPOSIT_BANK_NAME')?.trim();
    const accountName = this.config
      .get<string>('DEPOSIT_BANK_ACCOUNT_NAME')
      ?.trim();
    const accountNumber = this.config
      .get<string>('DEPOSIT_BANK_ACCOUNT_NUMBER')
      ?.trim();
    const branchCode = this.config
      .get<string>('DEPOSIT_BANK_BRANCH_CODE')
      ?.trim();
    return bank && accountName && accountNumber && branchCode
      ? { bank, accountName, accountNumber, branchCode }
      : null;
  }

  get isConfigured(): boolean {
    return this.depositAccount !== null;
  }

  async initiateDeposit(input: {
    amountCents: bigint;
    reference: string;
    entityId: string;
    transactionId: string;
    email: string;
  }) {
    const account = this.depositAccount;
    if (!account) {
      throw new ServiceUnavailableException(
        'Manual bank deposits are unavailable until verified settlement account details are configured.',
      );
    }
    return {
      status: 'pending' as const,
      instructions: {
        ...account,
        reference: input.reference,
        amountCents: String(input.amountCents),
        note: 'Use this reference. Wallet funds are added after the transfer is confirmed.',
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

  private get providerName(): 'manual' | 'paystack' {
    const provider = this.config.get<string>('PAYMENT_PROVIDER', 'manual');
    if (provider !== 'manual' && provider !== 'paystack') {
      throw new ServiceUnavailableException(
        'PAYMENT_PROVIDER must be set to manual or paystack.',
      );
    }
    return provider;
  }

  get active(): PaymentProvider {
    switch (this.providerName) {
      case 'manual':
        return this.manual;
      case 'paystack':
        return {
          name: 'paystack',
          initiateDeposit: (input) => this.paystack.initiateDeposit(input),
          initiateWithdrawal: (input) => this.manual.initiateWithdrawal(input),
        };
    }
  }

  get cardPaymentsEnabled(): boolean {
    return this.providerName === 'paystack' && this.paystack.isConfigured;
  }

  get manualEftEnabled(): boolean {
    switch (this.providerName) {
      case 'manual':
      case 'paystack':
        return this.manual.isConfigured;
    }
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
