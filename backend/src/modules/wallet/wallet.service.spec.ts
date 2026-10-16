jest.mock('@nestjs/config', () => ({
  ConfigService: class {},
}));

import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { LedgerService } from '../ledger/ledger.service';
import {
  PAYSTACK_CARD_METHOD_ID,
  PaymentService,
} from '../payments/payment.service';
import { SupabaseDataService } from '../../supabase/supabase-data.service';
import { TransactionKind } from '../../supabase/domain.enums';
import { UsersService } from '../users/users.service';
import { WalletService } from './wallet.service';

describe('WalletService manual deposit confirmation', () => {
  let module: TestingModule;
  let wallet: WalletService;
  const ensureWallet = jest.fn();
  const runTransaction = jest.fn();

  beforeEach(async () => {
    ensureWallet.mockReset();
    runTransaction.mockReset();

    const transactionRef = {
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          kind: TransactionKind.topUp,
          methodId: PAYSTACK_CARD_METHOD_ID,
        }),
      }),
    };
    const documents = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => transactionRef),
      })),
      runTransaction,
    };

    module = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: SupabaseDataService, useValue: { documents } },
        {
          provide: LedgerService,
          useValue: { ensureWallet },
        },
        { provide: UsersService, useValue: {} },
        { provide: PaymentService, useValue: {} },
        { provide: ConfigService, useValue: {} },
      ],
    }).compile();
    wallet = module.get(WalletService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('does not allow an administrator to bypass Paystack verification', async () => {
    await expect(
      wallet.confirmDeposit('admin-1', 'transaction-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ensureWallet).not.toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
  });
});
