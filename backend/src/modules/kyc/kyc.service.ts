import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityType, VerificationStatus } from '../../supabase/domain.enums';
import {
  DocumentData,
  DocumentReference,
  QueryDocumentSnapshot,
  SupabaseDataService,
} from '../../supabase/supabase-data.service';
import { UsersService } from '../users/users.service';

/** Manual admin KYC provider. Swap for Smile ID / Onfido later. */
@Injectable()
export class ManualKycProvider {
  readonly name = 'manual';
}

@Injectable()
export class KycService {
  constructor(
    private readonly supabase: SupabaseDataService,
    private readonly users: UsersService,
    private readonly provider: ManualKycProvider,
  ) {}

  private get documents() {
    return this.supabase.documents;
  }

  private toIso(value: unknown): string | null {
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString();
    if (
      typeof value === 'object' &&
      'toDate' in value &&
      typeof value.toDate === 'function'
    ) {
      return (value.toDate() as Date).toISOString();
    }
    throw new Error('A KYC record contains an invalid timestamp.');
  }

  private mapDocument(document: QueryDocumentSnapshot) {
    return {
      id: document.id,
      key: String(document.get('key') ?? ''),
      name: String(document.get('name') ?? ''),
      mimeType: String(document.get('mimeType') ?? ''),
      sizeBytes: Number(document.get('sizeBytes') ?? 0),
      storageKey: String(document.get('storageKey') ?? ''),
    };
  }

  private async mapDraft(
    draftId: string,
    draft: DocumentData,
    entity: { id: string; entityType: string },
  ) {
    const [documents, memberRows, invites] = await Promise.all([
      this.documents
        .collection('documents')
        .where('draftId', '==', draftId)
        .get(),
      this.documents
        .collection('kycMembers')
        .where('draftId', '==', draftId)
        .get(),
      this.documents
        .collection('kycInvites')
        .where('draftId', '==', draftId)
        .get(),
    ]);
    const members = await Promise.all(
      memberRows.docs.map(async (member) => {
        const memberDocuments = await this.documents
          .collection('documents')
          .where('memberId', '==', member.id)
          .get();
        return {
          id: member.id,
          role: String(member.get('role') ?? ''),
          fields: member.get('fields') ?? {},
          allocation: Number(member.get('allocation') ?? 0),
          documents: memberDocuments.docs.map((document) =>
            this.mapDocument(document),
          ),
        };
      }),
    );
    return {
      id: draftId,
      entityId: entity.id,
      entity: entity.entityType,
      fields: draft.fields ?? {},
      status: String(draft.status ?? VerificationStatus.incomplete),
      reviewNote: draft.reviewNote ?? null,
      submittedAt: this.toIso(draft.submittedAt),
      reviewedAt: this.toIso(draft.reviewedAt),
      provider: this.provider.name,
      documents: documents.docs.map((document) => this.mapDocument(document)),
      members,
      invites: invites.docs.map((invite) => ({
        id: invite.id,
        email: String(invite.get('email') ?? ''),
        role: String(invite.get('role') ?? ''),
        accepted: invite.get('accepted') === true,
      })),
    };
  }

  private async ensureDraft(entityId: string) {
    const reference = this.documents.collection('kycDrafts').doc(entityId);
    await this.documents.runTransaction(async (transaction) => {
      const draft = await transaction.get(reference);
      if (draft.exists) return;
      const now = new Date();
      transaction.create(reference, {
        entityId,
        fields: {},
        status: VerificationStatus.incomplete,
        reviewNote: null,
        submittedAt: null,
        reviewedAt: null,
        reviewedBy: null,
        createdAt: now,
        updatedAt: now,
      });
    });
    return reference.get();
  }

  async load(userId: string, entityType: EntityType) {
    const entity = await this.users.resolveEntity(userId, entityType);
    const draft = await this.ensureDraft(entity.id);
    return this.mapDraft(draft.id, draft.data()!, entity);
  }

  async save(
    userId: string,
    entityType: EntityType,
    fields: Record<string, unknown>,
  ) {
    const entity = await this.users.resolveEntity(userId, entityType);
    const now = new Date();
    await this.documents.collection('kycDrafts').doc(entity.id).set(
      {
        entityId: entity.id,
        fields,
        status: VerificationStatus.incomplete,
        reviewNote: null,
        updatedAt: now,
      },
      { merge: true },
    );
    await this.documents
      .collection('investorEntities')
      .doc(entity.id)
      .update({
        verificationStatus: VerificationStatus.incomplete,
        updatedAt: now,
      });
    return this.load(userId, entityType);
  }

  async upload(
    userId: string,
    entityType: EntityType,
    data: {
      key: string;
      name: string;
      mimeType: string;
      sizeBytes: number;
      storageKey: string;
      memberId?: string;
    },
  ) {
    const entity = await this.users.resolveEntity(userId, entityType);
    const draft = await this.ensureDraft(entity.id);
    if (
      !data.key.trim() ||
      !data.name.trim() ||
      !data.mimeType.trim() ||
      !data.storageKey.startsWith(`kyc/${entityType}/${userId}/`) ||
      !Number.isSafeInteger(data.sizeBytes) ||
      data.sizeBytes <= 0 ||
      data.sizeBytes > 5 * 1024 * 1024
    ) {
      throw new BadRequestException('Document metadata is invalid.');
    }
    const bucketName = process.env.SUPABASE_STORAGE_BUCKET ?? 'developify-private';
    const uploadedFile = this.supabase.storage
      .bucket(bucketName)
      .file(data.storageKey);
    const [fileMetadata] = await uploadedFile.getMetadata();
    if (
      fileMetadata.metadata?.ownerId !== userId ||
      Number(fileMetadata.size) !== data.sizeBytes ||
      fileMetadata.contentType !== data.mimeType
    ) {
      throw new BadRequestException('The uploaded KYC file could not be verified.');
    }
    if (data.memberId) {
      const member = await this.documents
        .collection('kycMembers')
        .doc(data.memberId)
        .get();
      if (!member.exists || member.get('draftId') !== draft.id) {
        throw new NotFoundException('KYC member not found.');
      }
    }
    await this.documents.collection('documents').add({
      draftId: draft.id,
      memberId: data.memberId ?? null,
      key: data.key,
      name: data.name,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      storageKey: data.storageKey,
      createdAt: new Date(),
    });
    return this.load(userId, entityType);
  }

  async deleteDocument(
    userId: string,
    entityType: EntityType,
    data: { key: string; documentId?: string; memberId?: string },
  ) {
    const entity = await this.users.resolveEntity(userId, entityType);
    const draft = await this.ensureDraft(entity.id);
    if (!data.key?.trim()) {
      throw new BadRequestException('A document key is required.');
    }
    if (data.memberId) {
      const member = await this.documents
        .collection('kycMembers')
        .doc(data.memberId)
        .get();
      if (!member.exists || member.get('draftId') !== draft.id) {
        throw new NotFoundException('KYC member not found.');
      }
    }
    const snapshot = await this.documents
      .collection('documents')
      .where('draftId', '==', draft.id)
      .get();
    const matches = snapshot.docs.filter(
      (document) =>
        document.get('key') === data.key &&
        (document.get('memberId') ?? null) === (data.memberId ?? null) &&
        (data.documentId == null || document.id === data.documentId),
    );
    if (matches.length === 0) {
      throw new NotFoundException('KYC document not found.');
    }
    const bucketName = process.env.SUPABASE_STORAGE_BUCKET ?? 'developify-private';
    for (const document of matches) {
      const storageKey = document.get('storageKey');
      if (
        typeof storageKey !== 'string' ||
        !storageKey.startsWith(`kyc/${entityType}/${userId}/`)
      ) {
        throw new BadRequestException('The KYC file reference is invalid.');
      }
      const file = this.supabase.storage.bucket(bucketName).file(storageKey);
      const [metadata] = await file.getMetadata();
      if (metadata.metadata?.ownerId !== userId) {
        throw new BadRequestException('The KYC file could not be verified.');
      }
      await file.delete({ ignoreNotFound: true });
    }
    const batch = this.documents.batch();
    for (const document of matches) batch.delete(document.ref);
    await batch.commit();
    return this.load(userId, entityType);
  }

  async saveMember(
    userId: string,
    entityType: EntityType,
    member: { id?: string; role: string; fields: object; allocation?: number },
  ) {
    const draft = await this.load(userId, entityType);
    if (!member.role.trim()) {
      throw new BadRequestException('A KYC member role is required.');
    }
    if (member.id) {
      const ref = this.documents.collection('kycMembers').doc(member.id);
      const existing = await ref.get();
      if (!existing.exists || existing.get('draftId') !== draft.id) {
        throw new NotFoundException('KYC member not found.');
      }
      await ref.update({
        role: member.role,
        fields: member.fields,
        allocation: member.allocation ?? 0,
        updatedAt: new Date(),
      });
    } else {
      await this.documents.collection('kycMembers').add({
        draftId: draft.id,
        role: member.role,
        fields: member.fields,
        allocation: member.allocation ?? 0,
        createdAt: new Date(),
      });
    }
    return this.load(userId, entityType);
  }

  async invite(
    userId: string,
    entityType: EntityType,
    invite: { email: string; role: string },
  ) {
    const draft = await this.load(userId, entityType);
    const email = invite.email.trim().toLowerCase();
    const role = invite.role.trim();
    if (!email || !role) {
      throw new BadRequestException(
        'An email and role are required for an invite.',
      );
    }
    const id = randomUUID();
    await this.documents.collection('kycInvites').doc(id).create({
      draftId: draft.id,
      email,
      role,
      token: randomUUID(),
      accepted: false,
      createdAt: new Date(),
    });
    return this.load(userId, entityType);
  }

  async submit(userId: string, entityType: EntityType) {
    const entity = await this.users.resolveEntity(userId, entityType);
    const draft = await this.ensureDraft(entity.id);
    const now = new Date();
    await this.documents.collection('kycDrafts').doc(draft.id).update({
      status: VerificationStatus.pending,
      submittedAt: now,
      updatedAt: now,
    });
    await this.documents
      .collection('investorEntities')
      .doc(entity.id)
      .update({
        verificationStatus: VerificationStatus.pending,
        updatedAt: now,
      });
    const updated = await this.documents
      .collection('kycDrafts')
      .doc(draft.id)
      .get();
    return this.mapDraft(draft.id, updated.data()!, entity);
  }

  async adminDecide(
    adminId: string,
    draftId: string,
    decision: 'verified' | 'correctionRequired' | 'incomplete',
    note?: string,
  ) {
    const reference = this.documents.collection('kycDrafts').doc(draftId);
    const draft = await reference.get();
    if (!draft.exists) throw new NotFoundException('KYC draft not found.');
    const entityId = String(draft.get('entityId') ?? '');
    const entityReference = this.documents
      .collection('investorEntities')
      .doc(entityId);
    const entity = await entityReference.get();
    if (!entity.exists)
      throw new NotFoundException('Investor entity not found.');
    const status =
      decision === 'verified'
        ? VerificationStatus.verified
        : decision === 'correctionRequired'
          ? VerificationStatus.correctionRequired
          : VerificationStatus.incomplete;
    const now = new Date();
    const batch = this.documents.batch();
    batch.update(reference, {
      status,
      reviewNote: note ?? null,
      reviewedAt: now,
      reviewedBy: adminId,
      updatedAt: now,
    });
    batch.update(entityReference, {
      verificationStatus: status,
      updatedAt: now,
    });
    const audit = this.documents.collection('auditLogs').doc();
    batch.create(audit, {
      actorAdminId: adminId,
      action: `kyc.${decision}`,
      resource: 'kycDraft',
      resourceId: draftId,
      metadata: { note: note ?? null },
      createdAt: now,
    });
    await batch.commit();
    const updated = await reference.get();
    return this.mapDraft(draftId, updated.data()!, {
      id: entity.id,
      entityType: String(entity.get('entityType') ?? ''),
    });
  }

  async adminQueue() {
    const drafts = await this.documents
      .collection('kycDrafts')
      .where('status', '==', VerificationStatus.pending)
      .limit(200)
      .get();
    const queue = await Promise.all(
      drafts.docs.map(async (draft) => {
        const entityId = String(draft.get('entityId') ?? '');
        const entity = await this.documents
          .collection('investorEntities')
          .doc(entityId)
          .get();
        if (!entity.exists) return null;
        const userId = String(entity.get('userId') ?? '');
        const user = await this.documents.collection('users').doc(userId).get();
        const documents = await this.documents
          .collection('documents')
          .where('draftId', '==', draft.id)
          .get();
        return {
          id: draft.id,
          entityId,
          fields: draft.get('fields') ?? {},
          status: draft.get('status'),
          reviewNote: draft.get('reviewNote') ?? null,
          submittedAt: this.toIso(draft.get('submittedAt')),
          reviewedAt: this.toIso(draft.get('reviewedAt')),
          entity: {
            id: entity.id,
            entityType: entity.get('entityType'),
            user: user.exists
              ? {
                  id: user.id,
                  email: user.get('email'),
                  name: user.get('name'),
                }
              : null,
          },
          documents: documents.docs.map((document) =>
            this.mapDocument(document),
          ),
        };
      }),
    );
    return queue
      .filter((item) => item != null)
      .sort(
        (left, right) =>
          new Date(left!.submittedAt ?? 0).getTime() -
          new Date(right!.submittedAt ?? 0).getTime(),
      );
  }
}
