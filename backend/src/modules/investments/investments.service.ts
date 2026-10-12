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
  TransactionKind,
  TransactionStatus,
  VerificationStatus,
} from '../../firebase/domain.enums';
import { FirebaseAdminService } from '../../firebase/firebase-admin.service';
import { firestoreDate } from '../../firebase/firestore-date';
import { LedgerService } from '../ledger/ledger.service';
import { UsersService } from '../users/users.service';
import { parseAmountCents } from './amount-cents';

@Injectable()
export class InvestmentsService {
  constructor(
    private readonly firebase: FirebaseAdminService,
    private readonly ledger: LedgerService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  private get firestore() {
    return this.firebase.firestore;
  }

  private transactionId(entityId: string, operationId: string) {
    return createHash('sha256')
      .update(`${entityId}|${operationId}`)
      .digest('hex');
  }

  private mapTransaction(id: string, data: FirebaseFirestore.DocumentData) {
    return {
      transactionId: id,
      investmentId: data.investmentId ?? null,
      status: data.status,
      reference: data.reference,
      amountCents: Number(data.amountCents),
      receiptId: id,
    };
  }

  async createQuote(
    userId: string,
    projectId: string,
    amountCents: number,
    entityType?: string,
  ) {
    const amount = parseAmountCents(amountCents);
    const entity = await this.users.resolveEntity(userId, entityType);
    const projectRef = this.firestore.collection('projects').doc(projectId);
    const project = await projectRef.get();
    const data = project.data();
    if (!data || data.status !== 'open') {
      throw new NotFoundException('Project is not available.');
    }
    const remaining =
      Number(data.capacityCents) - Number(data.fundedCents ?? 0);
    if (amount > remaining) {
      throw new BadRequestException('Amount exceeds remaining capacity.');
    }
    if (amount < Number(data.minInvestCents ?? 100)) {
      throw new BadRequestException('Amount is below project minimum.');
    }
    const ttl = Number(this.config.get('QUOTE_TTL_MINUTES', 10));
    const expiresAt = new Date(Date.now() + ttl * 60 * 1000);
    const quoteRef = this.firestore.collection('investmentQuotes').doc();
    await quoteRef.create({
      entityId: entity.id,
      projectId,
      amountCents: amount,
      rateBps: Number(data.annualRateBps),
      termMonths: Number(data.termMonths ?? 36),
      expiresAt,
      consumedAt: null,
      createdAt: new Date(),
    });
    return {
      id: quoteRef.id,
      projectId,
      amountCents: amount,
      rateBps: Number(data.annualRateBps),
      termMonths: Number(data.termMonths ?? 36),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async invest(input: {
    userId: string;
    projectId: string;
    amountCents: number;
    operationId: string;
    pin: string;
    quoteId?: string;
    entityType?: string;
  }) {
    await this.users.verifyPin(input.userId, input.pin);
    const entity = await this.users.resolveEntity(
      input.userId,
      input.entityType,
    );
    if (entity.verificationStatus !== VerificationStatus.verified) {
      throw new BadRequestException('KYC verification is required to invest.');
    }

    const amountRequested = parseAmountCents(input.amountCents);
    const id = this.transactionId(entity.id, input.operationId);
    const transactionRef = this.firestore.collection('transactions').doc(id);
    const projectRef = this.firestore
      .collection('projects')
      .doc(input.projectId);
    const quoteRef = input.quoteId
      ? this.firestore.collection('investmentQuotes').doc(input.quoteId)
      : null;
    const wallet = await this.ledger.ensureWallet(entity.id);
    const held = await this.ledger.ensureTypedAccount(
      LedgerAccountType.heldPrincipal,
    );
    const investmentRef = this.firestore.collection('investments').doc();
    const reference = `INV-${randomUUID().slice(0, 8).toUpperCase()}`;
    const now = new Date();

    return this.firestore.runTransaction(async (transaction) => {
      const snapshots = await Promise.all([
        transaction.get(transactionRef),
        transaction.get(projectRef),
        ...(quoteRef ? [transaction.get(quoteRef)] : []),
      ]);
      const existing = snapshots[0];
      if (existing.exists) {
        return this.mapTransaction(existing.id, existing.data()!);
      }
      const projectSnapshot = snapshots[1];
      const project = projectSnapshot.data();
      if (!project || project.status !== 'open') {
        throw new BadRequestException('Project is not available.');
      }

      let amount = amountRequested;
      let rateBps = Number(project.annualRateBps);
      let termMonths = Number(project.termMonths ?? 36);
      if (quoteRef) {
        const quoteSnapshot = snapshots[2];
        const quote = quoteSnapshot.data();
        if (
          !quote ||
          quote.entityId !== entity.id ||
          quote.projectId !== input.projectId ||
          quote.consumedAt ||
          firestoreDate(quote.expiresAt).getTime() <= now.getTime()
        ) {
          throw new BadRequestException(
            'Investment quote is invalid or expired.',
          );
        }
        amount = parseAmountCents(Number(quote.amountCents));
        rateBps = Number(quote.rateBps);
        termMonths = Number(quote.termMonths);
      }

      const remaining =
        Number(project.capacityCents) - Number(project.fundedCents ?? 0);
      if (amount > remaining) {
        throw new BadRequestException('Project capacity exceeded.');
      }
      if (amount < Number(project.minInvestCents ?? 100)) {
        throw new BadRequestException('Amount is below project minimum.');
      }

      const funded = Number(project.fundedCents ?? 0) + amount;
      await this.ledger.postEntries(transaction, [
        {
          accountId: wallet.id,
          amountCents: -BigInt(amount),
          transactionId: id,
          memo: 'Investment debit',
        },
        {
          accountId: held.id,
          amountCents: BigInt(amount),
          transactionId: id,
          memo: 'Investment principal held',
        },
      ]);

      transaction.create(transactionRef, {
        entityId: entity.id,
        userId: input.userId,
        kind: TransactionKind.investment,
        status: TransactionStatus.successful,
        amountCents: amount,
        feeCents: 0,
        currency: 'ZAR',
        reference,
        projectId: input.projectId,
        investmentId: investmentRef.id,
        idempotencyKey: input.operationId,
        quoteId: input.quoteId ?? null,
        createdAt: now,
      });
      transaction.create(investmentRef, {
        entityId: entity.id,
        projectId: input.projectId,
        amountCents: amount,
        rateBps,
        termMonths,
        status: InvestmentStatus.active,
        principalHeld: true,
        quoteId: input.quoteId ?? null,
        createdAt: now,
        updatedAt: now,
      });
      const milestones = this.firestore.collection('investmentMilestones');
      transaction.create(milestones.doc(), {
        investmentId: investmentRef.id,
        stage: 'confirmed',
        title: 'Investment confirmed',
        completedAt: now,
        amountCents: amount,
        createdAt: now,
      });
      transaction.create(milestones.doc(), {
        investmentId: investmentRef.id,
        stage: 'foundation',
        title: 'Project underway',
        dueAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        amountCents: null,
        createdAt: now,
      });
      transaction.create(milestones.doc(), {
        investmentId: investmentRef.id,
        stage: 'matured',
        title: 'Maturity',
        dueAt: new Date(now.getTime() + termMonths * 30 * 24 * 60 * 60 * 1000),
        amountCents: amount,
        createdAt: now,
      });
      transaction.update(projectRef, {
        fundedCents: funded,
        status: funded >= Number(project.capacityCents) ? 'funded' : 'open',
        updatedAt: now,
      });
      if (quoteRef) transaction.update(quoteRef, { consumedAt: now });
      transaction.create(this.firestore.collection('notifications').doc(), {
        userId: input.userId,
        entityId: entity.id,
        title: 'Investment confirmed',
        body: `Your investment of R${(amount / 100).toFixed(2)} was confirmed.`,
        kind: 'investment',
        payload: { investmentId: investmentRef.id, projectId: input.projectId },
        readAt: null,
        createdAt: now,
      });
      return {
        transactionId: id,
        investmentId: investmentRef.id,
        status: TransactionStatus.successful,
        reference,
        amountCents: amount,
        receiptId: id,
      };
    });
  }

  async adminAllocate(input: {
    adminId: string;
    investorNumber: string;
    projectId: string;
    amountCents: number;
    idempotencyKey: string;
  }) {
    const amount = parseAmountCents(input.amountCents);
    const investorNumber = input.investorNumber.trim();
    if (!/^\d{7}$/.test(investorNumber)) {
      throw new BadRequestException('Investor ID must be seven digits.');
    }
    const users = await this.firestore
      .collection('users')
      .where('investorNumber', '==', investorNumber)
      .limit(1)
      .get();
    const user = users.docs[0];
    if (!user) throw new NotFoundException('Investor was not found.');
    const entity = await this.users.resolveEntity(user.id);
    if (entity.verificationStatus !== VerificationStatus.verified) {
      throw new BadRequestException(
        'Investor must be verified before funds can be allocated.',
      );
    }

    const id = this.transactionId(entity.id, input.idempotencyKey);
    const transactionRef = this.firestore.collection('transactions').doc(id);
    const projectRef = this.firestore
      .collection('projects')
      .doc(input.projectId);
    const wallet = await this.ledger.ensureWallet(entity.id);
    const held = await this.ledger.ensureTypedAccount(
      LedgerAccountType.heldPrincipal,
    );
    const investmentRef = this.firestore.collection('investments').doc();
    const reference = `ALC-${randomUUID().slice(0, 8).toUpperCase()}`;
    const now = new Date();

    return this.firestore.runTransaction(async (transaction) => {
      const [existing, projectSnapshot] = await Promise.all([
        transaction.get(transactionRef),
        transaction.get(projectRef),
      ]);
      if (existing.exists) {
        const data = existing.data()!;
        return {
          investmentId: data.investmentId,
          transactionId: existing.id,
          reference: data.reference,
          amountCents: Number(data.amountCents),
          investorNumber,
          projectName: projectSnapshot.get('name') ?? '',
          status: data.status,
        };
      }
      const project = projectSnapshot.data();
      if (!project || project.status !== 'open') {
        throw new BadRequestException('Project is not open for allocation.');
      }
      const minimum = Number(project.minInvestCents ?? 100);
      const capacity = Number(project.capacityCents);
      const funded = Number(project.fundedCents ?? 0);
      if (amount < minimum) {
        throw new BadRequestException('Amount is below the project minimum.');
      }
      if (amount > capacity - funded) {
        throw new BadRequestException('Amount exceeds remaining capacity.');
      }

      const newFunded = funded + amount;
      await this.ledger.postEntries(transaction, [
        {
          accountId: wallet.id,
          amountCents: -BigInt(amount),
          transactionId: id,
          memo: 'Admin allocation debit',
        },
        {
          accountId: held.id,
          amountCents: BigInt(amount),
          transactionId: id,
          memo: 'Admin allocation principal held',
        },
      ]);
      transaction.create(transactionRef, {
        entityId: entity.id,
        userId: user.id,
        kind: TransactionKind.investment,
        status: TransactionStatus.successful,
        amountCents: amount,
        feeCents: 0,
        currency: 'ZAR',
        reference,
        idempotencyKey: input.idempotencyKey,
        projectId: input.projectId,
        investmentId: investmentRef.id,
        metadata: { source: 'admin', adminId: input.adminId },
        createdAt: now,
      });
      transaction.create(investmentRef, {
        entityId: entity.id,
        projectId: input.projectId,
        amountCents: amount,
        rateBps: Number(project.annualRateBps),
        termMonths: Number(project.termMonths ?? 36),
        status: InvestmentStatus.active,
        principalHeld: true,
        createdAt: now,
        updatedAt: now,
      });
      transaction.create(
        this.firestore.collection('investmentMilestones').doc(),
        {
          investmentId: investmentRef.id,
          stage: 'confirmed',
          title: 'Allocated by admin',
          completedAt: now,
          amountCents: amount,
          createdAt: now,
        },
      );
      transaction.update(projectRef, {
        fundedCents: newFunded,
        status: newFunded >= capacity ? 'funded' : 'open',
        updatedAt: now,
      });
      transaction.create(this.firestore.collection('auditLogs').doc(), {
        actorAdminId: input.adminId,
        action: 'investment.allocate',
        resource: 'investment',
        resourceId: investmentRef.id,
        metadata: {
          investorNumber,
          projectId: input.projectId,
          amountCents: amount,
        },
        createdAt: now,
      });
      transaction.create(this.firestore.collection('notifications').doc(), {
        userId: user.id,
        entityId: entity.id,
        title: 'Funds allocated',
        body: `R${(amount / 100).toFixed(2)} was allocated to ${project.name}.`,
        kind: 'investment',
        payload: { investmentId: investmentRef.id, projectId: input.projectId },
        readAt: null,
        createdAt: now,
      });
      return {
        investmentId: investmentRef.id,
        transactionId: id,
        reference,
        amountCents: amount,
        investorNumber,
        projectName: String(project.name ?? ''),
        status: TransactionStatus.successful,
      };
    });
  }

  async adminListAllocations() {
    const investments = await this.firestore
      .collection('investments')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    return Promise.all(
      investments.docs.map(async (investment) => {
        const data = investment.data();
        const [project, entity] = await Promise.all([
          this.firestore.collection('projects').doc(data.projectId).get(),
          this.firestore
            .collection('investorEntities')
            .doc(data.entityId)
            .get(),
        ]);
        const userId = entity.get('userId');
        const user = userId
          ? await this.firestore.collection('users').doc(userId).get()
          : null;
        return {
          id: investment.id,
          amountCents: Number(data.amountCents),
          status: data.status,
          createdAt: firestoreDate(data.createdAt).toISOString(),
          projectName: project.get('name') ?? '',
          town: project.get('town') ?? '',
          investorName: user?.get('name') ?? '',
          investorNumber: user?.get('investorNumber') ?? '',
        };
      }),
    );
  }
}
