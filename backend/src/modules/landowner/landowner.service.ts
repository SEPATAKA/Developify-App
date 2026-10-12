import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PropertyStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { DocumentData } from 'firebase-admin/firestore';
import { FirebaseAdminService } from '../../firebase/firebase-admin.service';

@Injectable()
export class LandownerService {
  constructor(private readonly firebase: FirebaseAdminService) {}

  private get firestore() {
    return this.firebase.firestore;
  }

  private mapProperty(id: string, property: DocumentData) {
    return {
      id,
      name: String(property.name ?? ''),
      town: String(property.town ?? ''),
      address: String(property.address ?? ''),
      erf: String(property.erf ?? ''),
      size: String(property.size ?? ''),
      status: String(property.status ?? PropertyStatus.draft),
      fundingPercent: Number(property.fundingPercent ?? 0),
      draftStep: Number(property.draftStep ?? 1),
    };
  }

  private toMillis(value: unknown) {
    if (value instanceof Date) return value.getTime();
    if (
      typeof value === 'object' &&
      value !== null &&
      'toMillis' in value &&
      typeof value.toMillis === 'function'
    ) {
      return value.toMillis() as number;
    }
    return 0;
  }

  private sortUpdated<T extends { get(field: string): unknown }>(
    left: T,
    right: T,
  ) {
    return (
      this.toMillis(right.get('updatedAt')) -
      this.toMillis(left.get('updatedAt'))
    );
  }

  private sortPaid<T extends { get(field: string): unknown }>(
    left: T,
    right: T,
  ) {
    return (
      this.toMillis(right.get('paidAt')) - this.toMillis(left.get('paidAt'))
    );
  }

  async overview(userId: string) {
    const properties = await this.firestore
      .collection('properties')
      .where('ownerId', '==', userId)
      .limit(200)
      .get();
    const payouts = (
      await Promise.all(
        properties.docs.map((property) =>
          this.firestore
            .collection('landownerPayouts')
            .where('propertyId', '==', property.id)
            .get(),
        ),
      )
    ).flatMap((snapshot) => snapshot.docs);
    payouts.sort(this.sortPaid.bind(this));
    const totalCents = payouts.reduce(
      (sum, payout) => sum + Number(payout.get('amountCents') ?? 0),
      0,
    );
    return {
      properties: properties.docs
        .sort(this.sortUpdated.bind(this))
        .map((property) => this.mapProperty(property.id, property.data())),
      earnedCents: totalCents,
      propertyCount: properties.size,
      approvedCount: properties.docs.filter((property) =>
        ['offerReady', 'live'].includes(String(property.get('status'))),
      ).length,
      nextPayoutCents: payouts[0] ? Number(payouts[0].get('amountCents')) : 0,
    };
  }

  async properties(userId: string) {
    const rows = await this.firestore
      .collection('properties')
      .where('ownerId', '==', userId)
      .limit(200)
      .get();
    return rows.docs
      .sort(this.sortUpdated.bind(this))
      .map((property) => this.mapProperty(property.id, property.data()));
  }

  async property(userId: string, id: string) {
    const property = await this.firestore
      .collection('properties')
      .doc(id)
      .get();
    if (!property.exists || property.get('ownerId') !== userId) {
      throw new NotFoundException('Property not found.');
    }
    return this.mapProperty(property.id, property.data()!);
  }

  async earnings(userId: string) {
    const properties = await this.firestore
      .collection('properties')
      .where('ownerId', '==', userId)
      .limit(200)
      .get();
    const payouts = (
      await Promise.all(
        properties.docs.map((property) =>
          this.firestore
            .collection('landownerPayouts')
            .where('propertyId', '==', property.id)
            .get(),
        ),
      )
    ).flatMap((snapshot) => snapshot.docs);
    payouts.sort(this.sortPaid.bind(this));
    const totalCents = payouts.reduce(
      (sum, payout) => sum + Number(payout.get('amountCents') ?? 0),
      0,
    );
    return {
      totalCents,
      nextPayoutCents: payouts[0] ? Number(payouts[0].get('amountCents')) : 0,
      payouts: payouts.map((payout) => {
        const paidAt = payout.get('paidAt');
        const date =
          paidAt && typeof paidAt.toDate === 'function'
            ? (paidAt.toDate() as Date).toISOString().slice(0, 10)
            : paidAt instanceof Date
              ? paidAt.toISOString().slice(0, 10)
              : '';
        return {
          id: payout.id,
          propertyName: String(payout.get('propertyName') ?? ''),
          amountCents: Number(payout.get('amountCents') ?? 0),
          period: String(payout.get('period') ?? ''),
          date,
        };
      }),
    };
  }

  private draftId(userId: string, draftKey: string) {
    return `${userId}__${draftKey}`;
  }

  async readDraft(userId: string, draftKey: string) {
    const draft = await this.firestore
      .collection('submissionDrafts')
      .doc(this.draftId(userId, draftKey))
      .get();
    if (!draft.exists) {
      return { id: draftKey, step: 1, payload: {}, documents: [] };
    }
    const documents = await this.firestore
      .collection('documents')
      .where('submissionId', '==', draft.id)
      .get();
    return {
      id: draftKey,
      step: Number(draft.get('step') ?? 1),
      payload: draft.get('payload') ?? {},
      documents: documents.docs.map((document) => ({
        id: document.id,
        key: document.get('key'),
        name: document.get('name'),
        mimeType: document.get('mimeType'),
        sizeBytes: document.get('sizeBytes'),
        storageKey: document.get('storageKey'),
      })),
    };
  }

  async saveDraft(
    userId: string,
    draftKey: string,
    step: number,
    payload: object,
  ) {
    if (!Number.isSafeInteger(step) || step < 1) {
      throw new BadRequestException('Draft step must be a positive integer.');
    }
    const reference = this.firestore
      .collection('submissionDrafts')
      .doc(this.draftId(userId, draftKey));
    const existing = await reference.get();
    const now = new Date();
    await reference.set(
      {
        ownerId: userId,
        draftKey,
        step,
        payload,
        createdAt: existing.get('createdAt') ?? now,
        updatedAt: now,
      },
      { merge: true },
    );
    return { id: draftKey, step, payload };
  }

  async submit(userId: string, draftKey: string) {
    const draft = await this.firestore
      .collection('submissionDrafts')
      .doc(this.draftId(userId, draftKey))
      .get();
    const payload = (draft.get('payload') ?? {}) as Record<string, unknown>;
    const size = payload.size;
    const propertyId = randomUUID();
    const property = {
      ownerId: userId,
      name:
        typeof payload.name === 'string' && payload.name.trim()
          ? payload.name.trim()
          : 'Untitled property',
      town:
        (typeof payload.town === 'string' && payload.town) ||
        (typeof payload.city === 'string' ? payload.city : ''),
      address: typeof payload.address === 'string' ? payload.address : '',
      erf:
        (typeof payload.erf === 'string' && payload.erf) ||
        (typeof payload.number === 'string' ? payload.number : ''),
      size:
        typeof size === 'string' && size
          ? `${size} ${typeof payload.unit === 'string' ? payload.unit : 'm²'}`
          : '',
      status: PropertyStatus.underReview,
      fundingPercent: 0,
      draftStep: Number(draft.get('step') ?? 9),
      metadata: payload,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.firestore
      .collection('properties')
      .doc(propertyId)
      .create(property);
    return { propertyId };
  }

  async adminSetStatus(
    adminId: string,
    propertyId: string,
    status: PropertyStatus,
  ) {
    const propertyRef = this.firestore.collection('properties').doc(propertyId);
    const propertySnapshot = await propertyRef.get();
    if (!propertySnapshot.exists) {
      throw new NotFoundException('Property not found.');
    }
    const property = propertySnapshot.data()!;
    const now = new Date();
    const batch = this.firestore.batch();
    batch.update(propertyRef, { status, updatedAt: now });
    let projectId: string | null = null;
    if (status === PropertyStatus.live) {
      projectId = `property-${propertyId}`;
      const projectRef = this.firestore.collection('projects').doc(projectId);
      const existingProject = await projectRef.get();
      if (!existingProject.exists) {
        batch.create(projectRef, {
          slug: `prop-${propertyId.slice(0, 8)}`,
          name: String(property.name ?? ''),
          town: String(property.town ?? ''),
          description: `Investment opportunity from ${String(property.name ?? '')}`,
          annualRateBps: 1450,
          termMonths: 36,
          minInvestCents: 100,
          capacityCents: 500000000,
          fundedCents: 0,
          currency: 'ZAR',
          status: 'open',
          imageUrl: null,
          contentJson: null,
          publishedAt: now,
          createdAt: now,
          updatedAt: now,
          propertyId,
        });
      }
    }
    const audit = this.firestore.collection('auditLogs').doc();
    batch.create(audit, {
      actorAdminId: adminId,
      action: `property.${status}`,
      resource: 'property',
      resourceId: propertyId,
      createdAt: now,
    });
    await batch.commit();
    return this.mapProperty(propertyId, { ...property, status });
  }

  async adminCreate(
    adminId: string,
    input: {
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
    const email = input.ownerEmail?.toLowerCase().trim();
    const investorNumber = input.investorNumber?.trim();
    if (!email && !investorNumber) {
      throw new BadRequestException(
        'Enter the owner email or seven-digit investor ID.',
      );
    }
    const users = this.firestore.collection('users');
    const ownerQuery = investorNumber
      ? users.where('investorNumber', '==', investorNumber).limit(1)
      : users.where('email', '==', email).limit(1);
    const owners = await ownerQuery.get();
    const owner = owners.docs[0];
    if (!owner) {
      throw new NotFoundException(
        'Owner account was not found. Use an existing investor or landowner.',
      );
    }
    const name = input.name.trim();
    const town = input.town.trim();
    if (!name || !town) {
      throw new BadRequestException('Property name and town are required.');
    }
    const propertyId = randomUUID();
    const now = new Date();
    const property = {
      ownerId: owner.id,
      name,
      town,
      address: input.address?.trim() ?? '',
      erf: input.erf?.trim() ?? '',
      size: input.size?.trim() ?? '',
      status: input.status ?? PropertyStatus.underReview,
      fundingPercent: 0,
      draftStep: 1,
      createdAt: now,
      updatedAt: now,
    };
    const batch = this.firestore.batch();
    batch.create(
      this.firestore.collection('properties').doc(propertyId),
      property,
    );
    batch.create(this.firestore.collection('auditLogs').doc(), {
      actorAdminId: adminId,
      action: 'property.create',
      resource: 'property',
      resourceId: propertyId,
      metadata: { ownerId: owner.id },
      createdAt: now,
    });
    await batch.commit();
    return {
      ...this.mapProperty(propertyId, property),
      owner: {
        name: String(owner.get('name') ?? ''),
        email: String(owner.get('email') ?? ''),
      },
    };
  }

  async adminList() {
    const properties = await this.firestore
      .collection('properties')
      .limit(500)
      .get();
    const rows = await Promise.all(
      properties.docs.map(async (property) => {
        const owner = await this.firestore
          .collection('users')
          .doc(String(property.get('ownerId') ?? ''))
          .get();
        return {
          ...this.mapProperty(property.id, property.data()),
          owner: owner.exists
            ? {
                name: String(owner.get('name') ?? ''),
                email: String(owner.get('email') ?? ''),
              }
            : null,
          updatedAt: this.toMillis(property.get('updatedAt')),
        };
      }),
    );
    return rows
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(({ updatedAt: _, ...property }) => property);
  }
}
