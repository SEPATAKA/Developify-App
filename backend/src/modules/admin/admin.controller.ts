import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ProjectStatus, PropertyStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { FirebaseAdminService } from '../../firebase/firebase-admin.service';
import { firestoreDate } from '../../firebase/firestore-date';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { InvestmentsService } from '../investments/investments.service';
import { KycService } from '../kyc/kyc.service';
import { LandownerService } from '../landowner/landowner.service';
import { WalletService } from '../wallet/wallet.service';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly wallet: WalletService,
    private readonly landowner: LandownerService,
    private readonly kyc: KycService,
    private readonly investments: InvestmentsService,
    private readonly firebase: FirebaseAdminService,
  ) {}

  @Roles('admin', 'ops', 'compliance')
  @Get('dashboard')
  async dashboard() {
    const db = this.firebase.firestore;
    const count = async (query: FirebaseFirestore.Query) =>
      (await query.count().get()).data().count;
    const [
      users,
      pendingKyc,
      pendingDeposits,
      pendingWithdrawals,
      properties,
      projects,
    ] = await Promise.all([
      count(db.collection('users')),
      count(db.collection('kycDrafts').where('status', '==', 'pending')),
      count(
        db
          .collection('transactions')
          .where('kind', '==', 'topUp')
          .where('status', '==', 'pending'),
      ),
      count(
        db
          .collection('transactions')
          .where('kind', '==', 'withdrawal')
          .where('status', '==', 'pending'),
      ),
      count(db.collection('properties').where('status', '==', 'underReview')),
      count(db.collection('projects')),
    ]);
    return {
      users,
      pendingKyc,
      pendingDeposits,
      pendingWithdrawals,
      propertiesUnderReview: properties,
      projects,
    };
  }

  @Roles('admin', 'ops', 'compliance')
  @Get('users')
  users() {
    return this.firebase.listUserProfiles();
  }

  @Roles('admin')
  @Patch('users/:id/lock')
  async lockUser(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: { locked: boolean },
  ) {
    const user = await this.firebase.setUserLocked(id, body.locked, admin.id);
    if (!user) throw new NotFoundException('User profile not found.');
    return user;
  }

  @Roles('admin', 'ops')
  @Get('transactions')
  async transactions() {
    const snapshot = await this.firebase.firestore
      .collection('transactions')
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();
    const rows: FirebaseFirestore.DocumentData[] = snapshot.docs.map(
      (doc): FirebaseFirestore.DocumentData => ({
        ...doc.data(),
        id: doc.id,
      }),
    );
    return Promise.all(
      rows.map(async (transaction) => {
        const entity = transaction.entityId
          ? await this.firebase.firestore
              .collection('investorEntities')
              .doc(transaction.entityId)
              .get()
          : null;
        const userId = entity?.get('userId');
        const user = userId
          ? await this.firebase.firestore.collection('users').doc(userId).get()
          : null;
        return {
          ...transaction,
          amountCents: Number(transaction.amountCents),
          feeCents: Number(transaction.feeCents ?? 0),
          createdAt: firestoreDate(transaction.createdAt),
          entity: entity?.exists
            ? { ...entity.data(), user: user?.data() ?? null }
            : null,
        };
      }),
    );
  }

  @Roles('admin', 'ops')
  @Get('projects')
  async projects() {
    const snapshot = await this.firebase.firestore
      .collection('projects')
      .orderBy('createdAt', 'desc')
      .get();
    const projects: FirebaseFirestore.DocumentData[] = snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }),
    );
    return projects.map((project) => ({
      ...project,
      minInvestCents: String(project.minInvestCents ?? 100),
      capacityCents: String(project.capacityCents ?? 0),
      fundedCents: String(project.fundedCents ?? 0),
    }));
  }

  @Roles('admin', 'ops')
  @Post('projects')
  async createProject(
    @CurrentUser() admin: AuthUser,
    @Body()
    body: {
      slug: string;
      name: string;
      town: string;
      description?: string;
      annualRateBps: number;
      termMonths?: number;
      minInvestCents?: number;
      capacityCents: number;
      status?: ProjectStatus;
      imageUrl?: string;
      contentJson?: object;
    },
  ) {
    if (
      !body.slug?.trim() ||
      !body.name?.trim() ||
      !body.town?.trim() ||
      !Number.isSafeInteger(body.capacityCents) ||
      body.capacityCents <= 0 ||
      !Number.isSafeInteger(body.annualRateBps) ||
      body.annualRateBps < 0
    ) {
      throw new BadRequestException('Project details are invalid.');
    }
    const db = this.firebase.firestore;
    const slug = body.slug.trim();
    const duplicate = await db
      .collection('projects')
      .where('slug', '==', slug)
      .limit(1)
      .get();
    if (!duplicate.empty) {
      throw new BadRequestException('A project with this slug already exists.');
    }
    const now = new Date();
    const projectRef = db.collection('projects').doc(randomUUID());
    const project = {
      slug,
      name: body.name.trim(),
      town: body.town.trim(),
      description: body.description ?? '',
      annualRateBps: body.annualRateBps,
      termMonths: body.termMonths ?? 36,
      minInvestCents: body.minInvestCents ?? 100,
      capacityCents: body.capacityCents,
      fundedCents: 0,
      currency: 'ZAR',
      status: body.status ?? 'open',
      imageUrl: body.imageUrl ?? null,
      contentJson: body.contentJson ?? null,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await db.runTransaction(async (transaction) => {
      transaction.create(projectRef, project);
      transaction.create(db.collection('auditLogs').doc(), {
        actorAdminId: admin.id,
        action: 'project.create',
        resource: 'project',
        resourceId: projectRef.id,
        createdAt: now,
      });
    });
    return {
      id: projectRef.id,
      ...project,
      minInvestCents: Number(project.minInvestCents),
    };
  }

  @Roles('admin', 'ops')
  @Put('projects/:id')
  async updateProject(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const projectRef = this.firebase.firestore.collection('projects').doc(id);
    if (!(await projectRef.get()).exists) {
      throw new NotFoundException('Project not found.');
    }
    const allowed = [
      'slug',
      'name',
      'town',
      'description',
      'annualRateBps',
      'termMonths',
      'minInvestCents',
      'capacityCents',
      'status',
      'imageUrl',
      'contentJson',
    ];
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        data[key] = body[key];
      }
    }
    for (const key of ['capacityCents', 'minInvestCents'] as const) {
      const value = data[key];
      if (
        value !== undefined &&
        (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
      ) {
        throw new BadRequestException(`${key} must be a non-negative integer.`);
      }
    }
    data.updatedAt = new Date();
    await projectRef.update(data);
    return { id, ...(await projectRef.get()).data() };
  }

  @Roles('admin', 'ops', 'compliance')
  @Get('audit-logs')
  async auditLogs() {
    const snapshot = await this.firebase.firestore
      .collection('auditLogs')
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  @Roles('admin')
  @Get('config')
  async config() {
    const snapshot = await this.firebase.firestore
      .collection('systemConfig')
      .get();
    return snapshot.docs.map((doc) => ({ key: doc.id, ...doc.data() }));
  }

  @Roles('admin')
  @Put('config/:key')
  async setConfig(@Param('key') key: string, @Body() body: { value: unknown }) {
    if (!key || key.includes('/')) {
      throw new BadRequestException('Configuration key is invalid.');
    }
    const reference = this.firebase.firestore
      .collection('systemConfig')
      .doc(key);
    await reference.set(
      { value: body.value, updatedAt: new Date() },
      { merge: true },
    );
    return { key, ...(await reference.get()).data() };
  }

  @Roles('admin', 'ops')
  @Get('properties')
  properties() {
    return this.landowner.adminList();
  }

  @Roles('admin', 'ops')
  @Post('properties')
  createProperty(
    @CurrentUser() admin: AuthUser,
    @Body()
    body: {
      ownerEmail?: string;
      investorNumber?: string;
      name: string;
      town: string;
      address?: string;
      erf?: string;
      size?: string;
      status?: PropertyStatus;
    },
  ) {
    return this.landowner.adminCreate(admin.id, body);
  }

  @Roles('admin', 'ops')
  @Get('allocations')
  allocations() {
    return this.investments.adminListAllocations();
  }

  @Roles('admin', 'ops')
  @Post('allocations')
  allocate(
    @CurrentUser() admin: AuthUser,
    @Body()
    body: {
      investorNumber: string;
      projectId: string;
      amountCents: number;
      idempotencyKey: string;
    },
  ) {
    return this.investments.adminAllocate({
      adminId: admin.id,
      investorNumber: body.investorNumber,
      projectId: body.projectId,
      amountCents: body.amountCents,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Roles('admin', 'ops')
  @Post('properties/:id/status')
  propertyStatus(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: { status: PropertyStatus },
  ) {
    return this.landowner.adminSetStatus(admin.id, id, body.status);
  }

  @Roles('admin', 'compliance', 'ops')
  @Get('kyc/queue')
  kycQueue() {
    return this.kyc.adminQueue();
  }

  @Roles('admin', 'ops')
  @Post('wallet/deposits/:id/confirm')
  confirmDeposit(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    return this.wallet.confirmDeposit(admin.id, id);
  }

  @Roles('admin', 'ops')
  @Post('wallet/withdrawals/:id/approve')
  approveWithdrawal(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    return this.wallet.approveWithdrawal(admin.id, id);
  }
}
