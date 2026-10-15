import {
  BadRequestException,
  InternalServerErrorException,
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
} from '../../supabase/domain.enums';
import {
  DocumentData,
  DocumentReference,
  SupabaseDataService,
} from '../../supabase/supabase-data.service';
import { documentDate } from '../../supabase/document-date';
import { LedgerService } from '../ledger/ledger.service';
import { UsersService } from '../users/users.service';
import {
  PAYSTACK_CARD_METHOD_ID,
  PaymentProvider,
  PaymentService,
} from '../payments/payment.service';

@Injectable()
export class WalletService {
  constructor(
    private readonly supabase: SupabaseDataService,
    private readonly ledger: LedgerService,
    private readonly users: UsersService,
    private readonly payments: PaymentService,
    private readonly config: ConfigService,
  ) {}

  private get documents() {
    return this.supabase.documents;
  }

  private idempotentId(entityId: string, operationId: string) {
    return createHash('sha256')
      .update(`${entityId}|${operationId}`)
      .digest('hex');
  }

  private mapTx(id: string, transaction: DocumentData) {
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
      createdAt: documentDate(transaction.createdAt).toISOString(),
    };
  }

  private async mapInvestment(
    id: string,
    investment: DocumentData,
  ) {
    const [project, milestones] = await Promise.all([
      this.documents.collection('projects').doc(investment.projectId).get(),
      this.documents
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
      createdAt: documentDate(investment.createdAt).toISOString(),
      milestones: milestones.docs.map((milestone) => {
        const data = milestone.data();
        return {
          id: milestone.id,
          stage: data.stage,
          title: data.title,
          dueAt: data.dueAt ? documentDate(data.dueAt).toISOString() : null,
          completedAt: data.completedAt
            ? documentDate(data.completedAt).toISOString()
            : null,
          amountCents:
            data.amountCents != null ? Number(data.amountCents) : null,
        };
      }),
    };
  }

  async balance(userId: string, entityType?: string) {
    const entity = await this.users.resolveEntity(userId, entityType);
    const [walletBalance, investmentSnapshot] = await Promise.all([
      this.ledger.walletBalanceForEntity(entity.id),
      this.documents
        .collection('investments')
        .where('entityId', '==', entity.id)
        .get(),
    ]);
    const availableCents = Number(walletBalance);
    if (!Number.isSafeInteger(availableCents)) {
      throw new InternalServerErrorException('Ledger balance is invalid.');
    }
    const heldPrincipalCents = investmentSnapshot.docs
      .map((doc) => doc.data())
      .filter(
        (investment) =>
          investment.principalHeld &&
          investment.status === InvestmentStatus.active,
      )
      .reduce((sum, investment) => sum + Number(investment.amountCents), 0);
    return {
      availableCents,
      heldPrincipalCents,
      verificationStatus: entity.verificationStatus,
      currency: 'ZAR',
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
      this.ledger.accountBalanceCents(wallet),
      this.documents
        .collection('investments')
        .where('entityId', '==', entity.id)
        .get(),
      this.documents
        .collection('transactions')
        .where('entityId', '==', entity.id)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get(),
      this.documents
        .collection('paymentMethods')
        .where('entityId', '==', entity.id)
        .get(),
      this.documents
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
          documentDate(b.data.createdAt).getTime() -
          documentDate(a.data.createdAt).getTime(),
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
          documentDate(b.data.createdAt).getTime() -
          documentDate(a.data.createdAt).getTime(),
      );
    const notifications = notificationSnapshot.docs
      .map((doc) => ({ id: doc.id, data: doc.data() }))
      .filter(
        ({ data }) => data.entityId === entity.id || data.entityId == null,
      )
      .sort(
        (a, b) =>
          documentDate(b.data.createdAt).getTime() -
          documentDate(a.data.createdAt).getTime(),
      )
      .slice(0, 50);

    return {
      entityId: entity.id,
      entityType: entity.entityType,
      verificationStatus: entity.verificationStatus,
      availableCents: Number(availableCents),
      heldPrincipalCents,
      currency: 'ZAR',
      cardPaymentsEnabled: this.payments.cardPaymentsEnabled,
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
        createdAt: documentDate(data.createdAt).toISOString(),
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
    const transaction = await this.documents
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
    const investment = await this.documents
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
    const transactionRef = this.documents
      .collection('transactions')
      .doc(transactionId);
    const existing = await transactionRef.get();
    if (existing.exists) {
      const data = existing.data()!;
      const metadata =
        typeof data.metadata === 'object' && data.metadata !== null
          ? data.metadata
          : {};
      return {
        ...this.mapTx(existing.id, data),
        ...(typeof metadata.checkoutUrl === 'string'
          ? { checkoutUrl: metadata.checkoutUrl }
          : {}),
        ...(metadata.reference ? { instructions: metadata } : {}),
      };
    }
    if (entity.verificationStatus !== VerificationStatus.verified) {
      throw new BadRequestException(
        'Complete verification before funding your wallet.',
      );
    }
    const paystackCard =
      input.methodId === PAYSTACK_CARD_METHOD_ID &&
      this.payments.cardPaymentsEnabled;
    if (!paystackCard) {
      const method = await this.documents
        .collection('paymentMethods')
        .doc(input.methodId)
        .get();
      if (!method.exists || method.get('entityId') !== entity.id) {
        throw new BadRequestException('Payment method not found.');
      }
    }
    const user = await this.documents
      .collection('users')
      .doc(input.userId)
      .get();
    const suffix = randomUUID().slice(0, 4).toUpperCase();
    const reference = user.get('investorNumber')
      ? `${user.get('investorNumber')}-${suffix}`
      : `DEP-${suffix}`;
    const amount = BigInt(input.amountCents);
    const paymentProvider = paystackCard
      ? this.payments.paystackTestProvider
      : this.payments.manualProvider;
    const payment: Awaited<ReturnType<PaymentProvider['initiateDeposit']>> =
      await paymentProvider.initiateDeposit({
        amountCents: amount,
        reference,
        entityId: entity.id,
        transactionId,
        email: String(user.get('email') ?? ''),
      });
    const now = new Date();
    await this.documents.runTransaction(async (transaction) => {
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
        metadata: {
          ...(payment.instructions ?? {}),
          ...(payment.checkoutUrl ? { checkoutUrl: payment.checkoutUrl } : {}),
        },
        createdAt: now,
      });
    });
    const created = await transactionRef.get();
    const createdData = created.data()!;
    const createdMetadata =
      typeof createdData.metadata === 'object' && createdData.metadata !== null
        ? createdData.metadata
        : {};
    return {
      ...this.mapTx(created.id, createdData),
      ...(typeof createdMetadata.checkoutUrl === 'string'
        ? { checkoutUrl: createdMetadata.checkoutUrl }
        : {}),
      ...(createdMetadata.reference ? { instructions: createdMetadata } : {}),
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
    const transactionRef = this.documents.collection('transactions').doc(id);
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
    const method = await this.documents
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
    await this.documents.runTransaction(async (transaction) => {
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
    const method = this.documents.collection('paymentMethods').doc();
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
    const method = this.documents.collection('paymentMethods').doc(id);
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
    const collection = this.documents.collection('paymentMethods');
    const methods = await collection.where('entityId', '==', entity.id).get();
    if (!methods.docs.some((method) => method.id === id)) {
      throw new NotFoundException('Payment method not found.');
    }
    await this.documents.runTransaction(async (transaction) => {
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
    const notifications = this.documents.collection('notifications');
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
      const batch = this.documents.batch();
      for (const notification of unread.slice(start, start + 450)) {
        batch.update(notification.ref, { readAt: new Date() });
      }
      await batch.commit();
    }
    return { ok: true };
  }

  async confirmDeposit(adminId: string, transactionId: string) {
    const transactionRef = this.documents
      .collection('transactions')
      .doc(transactionId);
    const initial = await transactionRef.get();
    const initialData = initial.data();
    if (!initialData || initialData.kind !== TransactionKind.topUp) {
      throw new NotFoundException('Deposit not found.');
    }
    return this.creditDeposit(transactionRef, initialData, adminId);
  }

  async confirmPaystackDeposit(reference: string) {
    const matches = await this.documents
      .collection('transactions')
      .where('reference', '==', reference)
      .limit(1)
      .get();
    const initial = matches.docs[0];
    const initialData = initial?.data();
    if (
      !initial ||
      !initialData ||
      initialData.kind !== TransactionKind.topUp ||
      typeof initialData.entityId !== 'string'
    ) {
      throw new NotFoundException('Paystack deposit not found.');
    }
    const verified =
      await this.payments.paystackTestProvider.verifyTransaction(reference);
    if (
      verified.reference !== reference ||
      verified.status !== 'success' ||
      verified.currency !== 'ZAR' ||
      verified.amountCents !== initialData.amountCents ||
      verified.transactionId !== initial.id ||
      verified.entityId !== initialData.entityId
    ) {
      throw new BadRequestException(
        'Paystack payment verification did not match the pending deposit.',
      );
    }
    return this.creditDeposit(initial.ref, initialData);
  }

  private async creditDeposit(
    transactionRef: DocumentReference,
    initialData: DocumentData,
    adminId?: string,
  ) {
    const [wallet, clearing] = await Promise.all([
      this.ledger.ensureWallet(String(initialData.entityId)),
      this.ledger.ensureTypedAccount(LedgerAccountType.platformClearing),
    ]);
    const notificationRef = this.documents
      .collection('notifications')
      .doc(`wallet-credit-${transactionRef.id}`);
    await this.documents.runTransaction(async (transaction) => {
      const current = await transaction.get(transactionRef);
      const data = current.data();
      if (!data || data.kind !== TransactionKind.topUp) {
        throw new NotFoundException('Deposit not found.');
      }
      if (data.status === TransactionStatus.successful) return;
      if (data.status !== TransactionStatus.pending) {
        throw new BadRequestException(
          'Only pending deposits can be credited to the wallet.',
        );
      }
      await this.ledger.postEntries(transaction, [
        {
          accountId: clearing.id,
          amountCents: -BigInt(data.amountCents),
          transactionId: transactionRef.id,
          memo: 'Deposit clearing',
        },
        {
          accountId: wallet.id,
          amountCents: BigInt(data.amountCents),
          transactionId: transactionRef.id,
          memo: 'Deposit credit',
        },
      ]);
      const now = new Date();
      transaction.update(transactionRef, {
        status: TransactionStatus.successful,
        updatedAt: now,
      });
      transaction.create(this.documents.collection('auditLogs').doc(), {
        actorAdminId: adminId ?? null,
        actor: adminId ? 'admin' : 'paystack',
        action: adminId ? 'deposit.confirm' : 'deposit.paystack.confirm',
        resource: 'transaction',
        resourceId: transactionRef.id,
        createdAt: now,
      });
      transaction.create(notificationRef, {
        userId: data.userId,
        entityId: data.entityId,
        title: 'Wallet funded',
        body: `R${(Number(data.amountCents) / 100).toFixed(2)} has been added to your wallet.`,
        kind: 'topUp',
        readAt: null,
        createdAt: now,
        payload: {
          transactionId: transactionRef.id,
          reference: data.reference,
          amountCents: data.amountCents,
        },
      });
    });
    const updated = await transactionRef.get();
    return this.mapTx(updated.id, updated.data()!);
  }

  async approveWithdrawal(adminId: string, transactionId: string) {
    const transactionRef = this.documents
      .collection('transactions')
      .doc(transactionId);
    await this.documents.runTransaction(async (transaction) => {
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
      transaction.create(this.documents.collection('auditLogs').doc(), {
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
