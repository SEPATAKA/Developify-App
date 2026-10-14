import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import {
  InvestmentStatus,
  LedgerAccountType,
  PaymentMethodKind,
  TransactionKind,
  TransactionStatus,
  VerificationStatus,
} from '../../firebase/domain.enums';
import { FirebaseAdminService } from '../../firebase/firebase-admin.service';
import { firestoreDate } from '../../firebase/firestore-date';
import { LedgerService } from '../ledger/ledger.service';
import { UsersService } from '../users/users.service';
import { PaymentService } from '../payments/payment.service';

@Injectable()
export class WalletService {
  constructor(
    private readonly firebase: FirebaseAdminService,
    private readonly ledger: LedgerService,
    private readonly users: UsersService,
    private readonly payments: PaymentService,
    private readonly config: ConfigService,
  ) {}

  private get firestore() {
    return this.firebase.firestore;
  }

  private idempotentId(entityId: string, operationId: string) {
    return createHash('sha256')
      .update(`${entityId}|${operationId}`)
      .digest('hex');
  }

  private mapTx(id: string, transaction: FirebaseFirestore.DocumentData) {
    return {
      id,
      kind: transaction.kind,
      status: transaction.status,
      amountCents: Number(transaction.amountCents),
      feeCents: Number(transaction.feeCents ?? 0),
      currency: transaction.currency ?? 'ZAR',
      reference: transaction.reference,
      projectId: transaction.projectId ?? null,
      investmentId: transaction.investmentId ?? null,
      createdAt: firestoreDate(transaction.createdAt).toISOString(),
    };
  }

  private async mapInvestment(
    id: string,
    investment: FirebaseFirestore.DocumentData,
  ) {
    const [project, milestones] = await Promise.all([
      this.firestore.collection('projects').doc(investment.projectId).get(),
      this.firestore
        .collection('investmentMilestones')
        .where('investmentId', '==', id)
        .get(),
    ]);
    return {
      id,
      projectId: investment.projectId,
      projectName: project.get('name'),
      town: project.get('town'),
      amountCents: Number(investment.amountCents),
      rateBps: Number(investment.rateBps),
      termMonths: Number(investment.termMonths),
      status: investment.status,
      principalHeld: Boolean(investment.principalHeld),
      createdAt: firestoreDate(investment.createdAt).toISOString(),
      milestones: milestones.docs.map((milestone) => {
        const data = milestone.data();
        return {
          id: milestone.id,
          stage: data.stage,
          title: data.title,
          dueAt: data.dueAt ? firestoreDate(data.dueAt).toISOString() : null,
          completedAt: data.completedAt
            ? firestoreDate(data.completedAt).toISOString()
            : null,
          amountCents:
            data.amountCents != null ? Number(data.amountCents) : null,
        };
      }),
    };
  }

  async snapshot(userId: string, entityType?: string) {
    const entity = await this.users.resolveEntity(userId, entityType);
    const wallet = await this.ledger.ensureWallet(entity.id);
    const [
      availableCents,
      investmentSnapshot,
      transactionSnapshot,
      methodSnapshot,
      notificationSnapshot,
    ] = await Promise.all([
      this.ledger.balanceCents(wallet.id),
      this.firestore
        .collection('investments')
        .where('entityId', '==', entity.id)
        .get(),
      this.firestore
        .collection('transactions')
        .where('entityId', '==', entity.id)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get(),
      this.firestore
        .collection('paymentMethods')
        .where('entityId', '==', entity.id)
        .get(),
      this.firestore
        .collection('notifications')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get(),
    ]);

    const investments = investmentSnapshot.docs
      .map((doc) => ({ id: doc.id, data: doc.data() }))
      .sort(
        (a, b) =>
          firestoreDate(b.data.createdAt).getTime() -
          firestoreDate(a.data.createdAt).getTime(),
      );
    const heldPrincipalCents = investments
      .filter(
        ({ data }) =>
          data.principalHeld && data.status === InvestmentStatus.active,
      )
      .reduce((sum, { data }) => sum + Number(data.amountCents), 0);
    const transactions = transactionSnapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data(),
    }));
    const methods = methodSnapshot.docs
      .map((doc) => ({ id: doc.id, data: doc.data() }))
      .sort(
        (a, b) =>
          firestoreDate(b.data.createdAt).getTime() -
          firestoreDate(a.data.createdAt).getTime(),
      );
    const notifications = notificationSnapshot.docs
      .map((doc) => ({ id: doc.id, data: doc.data() }))
      .filter(
        ({ data }) => data.entityId === entity.id || data.entityId == null,
      )
      .sort(
        (a, b) =>
          firestoreDate(b.data.createdAt).getTime() -
          firestoreDate(a.data.createdAt).getTime(),
      )
      .slice(0, 50);

    return {
      entityId: entity.id,
      entityType: entity.entityType,
      verificationStatus: entity.verificationStatus,
      availableCents: Number(availableCents),
      heldPrincipalCents,
      currency: 'ZAR',
      investments: await Promise.all(
        investments.map(({ id, data }) => this.mapInvestment(id, data)),
      ),
      transactions: transactions.map(({ id, data }) => this.mapTx(id, data)),
      paymentMethods: methods.map(({ id, data }) => ({
        id,
        kind: data.kind,
        name: data.name,
        lastFour: data.lastFour,
        holder: data.holder,
        expiry: data.expiry,
        bankType: data.bankType,
        branchCode: data.branchCode,
        reusable: Boolean(data.reusable),
        isDefault: Boolean(data.isDefault),
      })),
      notifications: notifications.map(({ id, data }) => ({
        id,
        title: data.title,
        body: data.body,
        kind: data.kind,
        read: !!data.readAt,
        createdAt: firestoreDate(data.createdAt).toISOString(),
        payload: data.payload ?? {},
      })),
      depositInstructions: {
        bank: 'Developify Holdings',
        accountNumber: '6284190219',
        branchCode: '250655',
        holder: 'Developify Holding',
      },
    };
  }

  async getTransaction(userId: string, id: string, entityType?: string) {
    const entity = await this.users.resolveEntity(userId, entityType);
    const transaction = await this.firestore
      .collection('transactions')
      .doc(id)
      .get();
    if (!transaction.exists || transaction.get('entityId') !== entity.id) {
      throw new NotFoundException('Transaction not found.');
    }
    return this.mapTx(transaction.id, transaction.data()!);
  }

  async getInvestment(userId: string, id: string, entityType?: string) {
    const entity = await this.users.resolveEntity(userId, entityType);
    const investment = await this.firestore
      .collection('investments')
      .doc(id)
      .get();
    if (!investment.exists || investment.get('entityId') !== entity.id) {
      throw new NotFoundException('Investment not found.');
    }
    return this.mapInvestment(investment.id, investment.data()!);
  }

  async addMoney(input: {
    userId: string;
    amountCents: number;
    methodId: string;
    operationId: string;
    pin: string;
    entityType?: string;
  }) {
    await this.users.verifyPin(input.userId, input.pin);
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 100) {
      throw new BadRequestException('Minimum deposit is R1.00.');
    }
    const entity = await this.users.resolveEntity(
      input.userId,
      input.entityType,
    );
    const transactionId = this.idempotentId(entity.id, input.operationId);
    const transactionRef = this.firestore
      .collection('transactions')
      .doc(transactionId);
    const existing = await transactionRef.get();
    if (existing.exists) return this.mapTx(existing.id, existing.data()!);
    if (entity.verificationStatus !== VerificationStatus.verified) {
      throw new BadRequestException(
        'Complete verification before funding your wallet.',
      );
    }
    const method = await this.firestore
      .collection('paymentMethods')
      .doc(input.methodId)
      .get();
    if (!method.exists || method.get('entityId') !== entity.id) {
      throw new BadRequestException('Payment method not found.');
    }
    const user = await this.firestore
      .collection('users')
      .doc(input.userId)
      .get();
    const suffix = randomUUID().slice(0, 4).toUpperCase();
    const reference = user.get('investorNumber')
      ? `${user.get('investorNumber')}-${suffix}`
      : `DEP-${suffix}`;
    const amount = BigInt(input.amountCents);
    const payment = await this.payments.active.initiateDeposit({
      amountCents: amount,
      reference,
      entityId: entity.id,
    });
    const now = new Date();
    await this.firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(transactionRef);
      if (current.exists) return;
      transaction.create(transactionRef, {
        entityId: entity.id,
        userId: input.userId,
        kind: TransactionKind.topUp,
        status: TransactionStatus.pending,
        amountCents: input.amountCents,
        feeCents: 0,
        currency: 'ZAR',
        reference,
        idempotencyKey: input.operationId,
        methodId: input.methodId,
        metadata: payment.instructions,
        createdAt: now,
      });
    });
    const created = await transactionRef.get();
    return {
      ...this.mapTx(created.id, created.data()!),
      instructions: payment.instructions,
    };
  }

  async withdraw(input: {
    userId: string;
    amountCents: number;
    methodId: string;
    operationId: string;
    pin: string;
    entityType?: string;
  }) {
    await this.users.verifyPin(input.userId, input.pin);
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 100) {
      throw new BadRequestException('Minimum withdrawal is R1.00.');
    }
    const entity = await this.users.resolveEntity(
      input.userId,
      input.entityType,
    );
    const id = this.idempotentId(entity.id, input.operationId);
    const transactionRef = this.firestore.collection('transactions').doc(id);
    const existing = await transactionRef.get();
    if (existing.exists) return this.mapTx(existing.id, existing.data()!);
    const feeValue = Number(this.config.get('WITHDRAWAL_FEE_CENTS', '150'));
    if (!Number.isSafeInteger(feeValue) || feeValue < 0) {
      throw new BadRequestException('Withdrawal fee configuration is invalid.');
    }
    const fee = BigInt(feeValue);
    const amount = BigInt(input.amountCents);
    const currentBalance = await this.ledger.walletBalanceForEntity(entity.id);
    if (currentBalance < amount + fee) {
      throw new BadRequestException('Insufficient available balance.');
    }
    const method = await this.firestore
      .collection('paymentMethods')
      .doc(input.methodId)
      .get();
    if (!method.exists || method.get('entityId') !== entity.id) {
      throw new BadRequestException('Payment method not found.');
    }

    const reference = `WDR-${randomUUID().slice(0, 8).toUpperCase()}`;
    await this.payments.active.initiateWithdrawal({
      amountCents: amount,
      reference,
      methodId: input.methodId,
    });
    const [wallet, clearing, feeAccount] = await Promise.all([
      this.ledger.ensureWallet(entity.id),
      this.ledger.ensureTypedAccount(LedgerAccountType.platformClearing),
      this.ledger.ensureTypedAccount(LedgerAccountType.feeRevenue),
    ]);
    const now = new Date();
    await this.firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(transactionRef);
      if (current.exists) return;
      await this.ledger.postEntries(transaction, [
        {
          accountId: wallet.id,
          amountCents: -(amount + fee),
          transactionId: id,
          memo: 'Withdrawal hold',
        },
        {
          accountId: clearing.id,
          amountCents: amount,
          transactionId: id,
          memo: 'Withdrawal clearing',
        },
        {
          accountId: feeAccount.id,
          amountCents: fee,
          transactionId: id,
          memo: 'Withdrawal fee',
        },
      ]);
      transaction.create(transactionRef, {
        entityId: entity.id,
        userId: input.userId,
        kind: TransactionKind.withdrawal,
        status: TransactionStatus.pending,
        amountCents: input.amountCents,
        feeCents: feeValue,
        currency: 'ZAR',
        reference,
        idempotencyKey: input.operationId,
        methodId: input.methodId,
        createdAt: now,
      });
    });
    const created = await transactionRef.get();
    return this.mapTx(created.id, created.data()!);
  }

  async addBankAccount(
    userId: string,
    data: {
      bank: string;
      accountNumber: string;
      accountType: string;
      branchCode: string;
      holder: string;
      entityType?: string;
    },
  ) {
    if (!data.accountNumber || !data.bank || !data.holder) {
      throw new BadRequestException('Bank details are incomplete.');
    }
    const entity = await this.users.resolveEntity(userId, data.entityType);
    const method = this.firestore.collection('paymentMethods').doc();
    const record = {
      userId,
      entityId: entity.id,
      kind: PaymentMethodKind.bankAccount,
      name: data.bank,
      lastFour: data.accountNumber.slice(-4),
      holder: data.holder,
      bankType: data.accountType,
      branchCode: data.branchCode,
      reusable: true,
      isDefault: false,
      createdAt: new Date(),
    };
    await method.create(record);
    return { id: method.id, ...record };
  }

  async addCard() {
    throw new BadRequestException({
      kind: 'configuration',
      message:
        'Card tokenization is not enabled. Use a bank account or configure Paystack.',
    });
  }

  async removePaymentMethod(userId: string, id: string, entityType?: string) {
    const entity = await this.users.resolveEntity(userId, entityType);
    const method = this.firestore.collection('paymentMethods').doc(id);
    const snapshot = await method.get();
    if (snapshot.exists && snapshot.get('entityId') === entity.id) {
      await method.delete();
    }
    return { ok: true };
  }

  async setDefaultPaymentMethod(
    userId: string,
    id: string,
    isDefault: boolean,
    entityType?: string,
  ) {
    const entity = await this.users.resolveEntity(userId, entityType);
    const collection = this.firestore.collection('paymentMethods');
    const methods = await collection.where('entityId', '==', entity.id).get();
    if (!methods.docs.some((method) => method.id === id)) {
      throw new NotFoundException('Payment method not found.');
    }
    await this.firestore.runTransaction(async (transaction) => {
      const latest = await Promise.all(
        methods.docs.map((method) => transaction.get(method.ref)),
      );
      for (const method of latest) {
        if (method.exists) {
          transaction.update(method.ref, {
            isDefault: isDefault
              ? method.id === id
              : method.id === id
                ? false
                : !!method.get('isDefault'),
            updatedAt: new Date(),
          });
        }
      }
    });
    return { ok: true };
  }

  async markNotificationsRead(userId: string, id?: string) {
    const notifications = this.firestore.collection('notifications');
    const snapshot = id ? await notifications.doc(id).get() : null;
    if (snapshot) {
      if (
        snapshot.exists &&
        snapshot.get('userId') === userId &&
        !snapshot.get('readAt')
      ) {
        await snapshot.ref.update({ readAt: new Date() });
      }
      return { ok: true };
    }
    const rows = await notifications.where('userId', '==', userId).get();
    const unread = rows.docs.filter(
      (notification) => !notification.get('readAt'),
    );
    for (let start = 0; start < unread.length; start += 450) {
      const batch = this.firestore.batch();
      for (const notification of unread.slice(start, start + 450)) {
        batch.update(notification.ref, { readAt: new Date() });
      }
      await batch.commit();
    }
    return { ok: true };
  }

  async confirmDeposit(adminId: string, transactionId: string) {
    const transactionRef = this.firestore
      .collection('transactions')
      .doc(transactionId);
    const initial = await transactionRef.get();
    const initialData = initial.data();
    if (!initialData || initialData.kind !== TransactionKind.topUp) {
      throw new NotFoundException('Deposit not found.');
    }
    const [wallet, clearing] = await Promise.all([
      this.ledger.ensureWallet(initialData.entityId),
      this.ledger.ensureTypedAccount(LedgerAccountType.platformClearing),
    ]);
    await this.firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(transactionRef);
      const data = current.data();
      if (!data || data.kind !== TransactionKind.topUp) {
        throw new NotFoundException('Deposit not found.');
      }
      if (data.status === TransactionStatus.successful) return;
      await this.ledger.postEntries(transaction, [
        {
          accountId: clearing.id,
          amountCents: -BigInt(data.amountCents),
          transactionId,
          memo: 'Deposit clearing',
        },
        {
          accountId: wallet.id,
          amountCents: BigInt(data.amountCents),
          transactionId,
          memo: 'Deposit credit',
        },
      ]);
      const now = new Date();
      transaction.update(transactionRef, {
        status: TransactionStatus.successful,
        updatedAt: now,
      });
      transaction.create(this.firestore.collection('auditLogs').doc(), {
        actorAdminId: adminId,
        action: 'deposit.confirm',
        resource: 'transaction',
        resourceId: transactionId,
        createdAt: now,
      });
    });
    const updated = await transactionRef.get();
    return this.mapTx(updated.id, updated.data()!);
  }

  async approveWithdrawal(adminId: string, transactionId: string) {
    const transactionRef = this.firestore
      .collection('transactions')
      .doc(transactionId);
    await this.firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(transactionRef);
      const data = current.data();
      if (!data || data.kind !== TransactionKind.withdrawal) {
        throw new NotFoundException('Withdrawal not found.');
      }
      if (data.status === TransactionStatus.successful) return;
      const now = new Date();
      transaction.update(transactionRef, {
        status: TransactionStatus.successful,
        updatedAt: now,
      });
      transaction.create(this.firestore.collection('auditLogs').doc(), {
        actorAdminId: adminId,
        action: 'withdrawal.approve',
        resource: 'transaction',
        resourceId: transactionId,
        createdAt: now,
      });
    });
    const updated = await transactionRef.get();
    return this.mapTx(updated.id, updated.data()!);
  }
}
