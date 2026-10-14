import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { LedgerAccountType } from '../../firebase/domain.enums';
import { FirebaseAdminService } from '../../firebase/firebase-admin.service';
import { assertBalancedLedger } from './ledger.utils';

@Injectable()
export class LedgerService {
  constructor(private readonly firebase: FirebaseAdminService) {}

  private get firestore() {
    return this.firebase.firestore;
  }

  async ensureWallet(entityId: string) {
    const id = `wallet-${entityId}`;
    return this.ensureAccount(id, LedgerAccountType.userWallet, { entityId });
  }

  async ensureTypedAccount(type: LedgerAccountType) {
    return this.ensureAccount(`system-${type}`, type);
  }

  async ensurePlatformAccounts() {
    await Promise.all([
      this.ensureTypedAccount(LedgerAccountType.platformClearing),
      this.ensureTypedAccount(LedgerAccountType.feeRevenue),
      this.ensureTypedAccount(LedgerAccountType.heldPrincipal),
    ]);
  }

  private async ensureAccount(
    id: string,
    type: LedgerAccountType,
    fields: { entityId?: string } = {},
  ) {
    const reference = this.firestore.collection('ledgerAccounts').doc(id);
    const account = await this.firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(reference);
      if (existing.exists) return existing.data()!;
      const created = {
        type,
        currency: 'ZAR',
        balanceCents: 0,
        ...fields,
        createdAt: new Date(),
      };
      transaction.create(reference, created);
      return created;
    });
    return { id, ...account };
  }

  async balanceCents(accountId: string): Promise<bigint> {
    const account = await this.firestore
      .collection('ledgerAccounts')
      .doc(accountId)
      .get();
    if (!account.exists) {
      throw new InternalServerErrorException('Ledger account was not found.');
    }
    const balance = account.get('balanceCents');
    if (typeof balance !== 'number' || !Number.isSafeInteger(balance)) {
      throw new InternalServerErrorException('Ledger balance is invalid.');
    }
    return BigInt(balance);
  }

  async walletBalanceForEntity(entityId: string): Promise<bigint> {
    const account = await this.ensureWallet(entityId);
    return this.balanceCents(account.id);
  }

  async postEntries(
    transaction: Transaction,
    entries: {
      accountId: string;
      amountCents: bigint;
      transactionId?: string;
      memo?: string;
    }[],
  ) {
    assertBalancedLedger(entries);
    const accountRefs = [
      ...new Set(entries.map((entry) => entry.accountId)),
    ].map((id) => this.firestore.collection('ledgerAccounts').doc(id));
    const accounts = await Promise.all(
      accountRefs.map((reference) => transaction.get(reference)),
    );
    const balances = new Map<string, bigint>();
    const types = new Map<string, string>();
    for (const account of accounts) {
      if (!account.exists) {
        throw new InternalServerErrorException('Ledger account was not found.');
      }
      const balance = account.get('balanceCents');
      if (typeof balance !== 'number' || !Number.isSafeInteger(balance)) {
        throw new InternalServerErrorException('Ledger balance is invalid.');
      }
      balances.set(account.id, BigInt(balance));
      types.set(account.id, String(account.get('type')));
    }

    const now = new Date();
    for (const entry of entries) {
      const balanceAfter = balances.get(entry.accountId)! + entry.amountCents;
      if (
        types.get(entry.accountId) === LedgerAccountType.userWallet &&
        balanceAfter < 0n
      ) {
        throw new BadRequestException('Insufficient available balance.');
      }
      const amountCents = Number(entry.amountCents);
      const nextBalance = Number(balanceAfter);
      if (
        !Number.isSafeInteger(amountCents) ||
        !Number.isSafeInteger(nextBalance)
      ) {
        throw new InternalServerErrorException(
          'Ledger amount exceeds the supported range.',
        );
      }
      balances.set(entry.accountId, balanceAfter);
      const ledgerEntry = this.firestore.collection('ledgerEntries').doc();
      transaction.create(ledgerEntry, {
        accountId: entry.accountId,
        transactionId: entry.transactionId ?? null,
        amountCents,
        balanceAfter: nextBalance,
        memo: entry.memo ?? '',
        createdAt: now,
      });
    }

    for (const reference of accountRefs) {
      transaction.update(reference, {
        balanceCents: Number(balances.get(reference.id)!),
        updatedAt: now,
      });
    }
  }
}
