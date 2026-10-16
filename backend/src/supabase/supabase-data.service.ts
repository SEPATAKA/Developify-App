import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createClient,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

export type DocumentData = Record<string, any>;
export type RegisteredUserProfile = {
  uid: string;
  email: string;
  name: string;
  phone: string;
  countryCode: string;
  entity: string;
  nonResident: boolean;
  experiences: ('investor' | 'landowner')[];
  registrationNumber?: string;
  representatives?: { name: string; identityNumber: string }[];
};
type WhereOperator = '==' | 'in';
type StoredDocument = {
  collection: string;
  document_id: string;
  data: DocumentData;
  version: number;
};
type ReadVersion =
  | { collection: string; id: string; version: number | null }
  | { collection: string; collection_version: number };
type UserSessionProfile = DocumentData & {
  id: string;
  memberships: DocumentData[];
  entities: DocumentData[];
};
type Operation = {
  collection: string;
  id: string;
  kind: 'create' | 'set' | 'update' | 'delete';
  data?: DocumentData;
  merge?: boolean;
};

export class QueryDocumentSnapshot {
  constructor(
    readonly id: string,
    private readonly value: DocumentData,
    readonly ref: DocumentReference,
    readonly refVersion: number,
  ) {}
  get exists() {
    return true;
  }
  data() {
    return this.value;
  }
  get(field: string) {
    return this.value[field];
  }
}

export class QuerySnapshot {
  constructor(
    readonly docs: QueryDocumentSnapshot[],
    readonly size = docs.length,
    private readonly countValue = size,
  ) {}
  get empty() {
    return this.docs.length === 0;
  }
  data() {
    return { count: this.countValue };
  }
}

export class DocumentReference {
  constructor(
    private readonly owner: SupabaseDataService,
    readonly collectionName: string,
    readonly id: string,
  ) {}
  get path() {
    return `${this.collectionName}/${this.id}`;
  }
  collection(name: string) {
    return new DocumentQuery(this.owner, `${this.path}/${name}`);
  }
  async get() {
    const row = await this.owner.readDocument(this.collectionName, this.id);
    return new DocumentSnapshot(this, row);
  }
  create(data: DocumentData) {
    return this.owner.commit([
      { collection: this.collectionName, id: this.id, kind: 'create', data },
    ]);
  }
  set(data: DocumentData, options?: { merge?: boolean }) {
    return this.owner.commit([
      {
        collection: this.collectionName,
        id: this.id,
        kind: 'set',
        data,
        merge: options?.merge === true,
      },
    ]);
  }
  update(data: DocumentData) {
    return this.owner.commit([
      { collection: this.collectionName, id: this.id, kind: 'update', data },
    ]);
  }
  delete(options?: { ignoreNotFound?: boolean }) {
    return this.owner.commit(
      [{ collection: this.collectionName, id: this.id, kind: 'delete' }],
      options?.ignoreNotFound,
    );
  }
}

export class DocumentSnapshot {
  constructor(
    readonly ref: DocumentReference,
    private readonly row: StoredDocument | null,
  ) {}
  get id() {
    return this.ref.id;
  }
  get exists() {
    return this.row !== null;
  }
  data() {
    return this.row?.data;
  }
  get(field: string) {
    return this.row?.data[field];
  }
  version() {
    return this.row?.version ?? null;
  }
}

export class DocumentQuery {
  private readonly filters: {
    field: string;
    operator: WhereOperator;
    value: unknown;
  }[] = [];
  private ordering?: { field: string; direction: 'asc' | 'desc' };
  private maxRows = 1000;
  private countOnly = false;
  constructor(
    private readonly owner: SupabaseDataService,
    readonly collectionName: string,
  ) {}
  doc(id = randomUUID().replace(/-/g, '')) {
    return new DocumentReference(this.owner, this.collectionName, id);
  }
  add(data: DocumentData) {
    const ref = this.doc();
    return ref.create(data).then(() => ref);
  }
  where(field: string, operator: WhereOperator, value: unknown) {
    if (operator !== '==' && operator !== 'in') {
      throw new Error(
        `Unsupported Supabase document query operator: ${operator}`,
      );
    }
    const next = this.clone();
    next.filters.push({ field, operator, value });
    return next;
  }
  orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
    const next = this.clone();
    next.ordering = { field, direction };
    return next;
  }
  limit(value: number) {
    const next = this.clone();
    next.maxRows = Math.min(Math.max(Math.trunc(value), 1), 1000);
    return next;
  }
  count() {
    const next = this.clone();
    next.countOnly = true;
    return next;
  }
  async get() {
    return this.owner.readQuery(this);
  }
  queryParameters() {
    return {
      filters: this.filters,
      ordering: this.ordering,
      limit: this.maxRows,
      countOnly: this.countOnly,
    };
  }
  private clone() {
    const next = new DocumentQuery(this.owner, this.collectionName);
    next.filters.push(...this.filters);
    next.ordering = this.ordering;
    next.maxRows = this.maxRows;
    next.countOnly = this.countOnly;
    return next;
  }
}

export class DocumentTransaction {
  readonly reads: ReadVersion[] = [];
  readonly operations: Operation[] = [];
  constructor(private readonly owner: SupabaseDataService) {}
  get(target: DocumentReference): Promise<DocumentSnapshot>;
  get(target: DocumentQuery): Promise<QuerySnapshot>;
  async get(
    target: DocumentReference | DocumentQuery,
  ): Promise<DocumentSnapshot | QuerySnapshot> {
    if (target instanceof DocumentReference) {
      const row = await this.owner.readDocument(
        target.collectionName,
        target.id,
      );
      this.reads.push({
        collection: target.collectionName,
        id: target.id,
        version: row?.version ?? null,
      });
      return new DocumentSnapshot(target, row);
    }
    const collectionVersion = await this.owner.collectionVersion(
      target.collectionName,
    );
    const snapshot = await target.get();
    this.reads.push({
      collection: target.collectionName,
      collection_version: collectionVersion,
    });
    this.reads.push(
      ...snapshot.docs.map((doc) => ({
        collection: target.collectionName,
        id: doc.id,
        version: doc.refVersion,
      })),
    );
    return snapshot;
  }
  create(ref: DocumentReference, data: DocumentData) {
    this.operations.push({
      collection: ref.collectionName,
      id: ref.id,
      kind: 'create',
      data,
    });
  }
  set(
    ref: DocumentReference,
    data: DocumentData,
    options?: { merge?: boolean },
  ) {
    this.operations.push({
      collection: ref.collectionName,
      id: ref.id,
      kind: 'set',
      data,
      merge: options?.merge === true,
    });
  }
  update(ref: DocumentReference, data: DocumentData) {
    this.operations.push({
      collection: ref.collectionName,
      id: ref.id,
      kind: 'update',
      data,
    });
  }
  delete(ref: DocumentReference) {
    this.operations.push({
      collection: ref.collectionName,
      id: ref.id,
      kind: 'delete',
    });
  }
}

export class DocumentWriteBatch {
  private readonly operations: Operation[] = [];
  constructor(private readonly owner: SupabaseDataService) {}
  create(ref: DocumentReference, data: DocumentData) {
    this.operations.push({
      collection: ref.collectionName,
      id: ref.id,
      kind: 'create',
      data,
    });
    return this;
  }
  set(
    ref: DocumentReference,
    data: DocumentData,
    options?: { merge?: boolean },
  ) {
    this.operations.push({
      collection: ref.collectionName,
      id: ref.id,
      kind: 'set',
      data,
      merge: options?.merge === true,
    });
    return this;
  }
  update(ref: DocumentReference, data: DocumentData) {
    this.operations.push({
      collection: ref.collectionName,
      id: ref.id,
      kind: 'update',
      data,
    });
    return this;
  }
  delete(ref: DocumentReference) {
    this.operations.push({
      collection: ref.collectionName,
      id: ref.id,
      kind: 'delete',
    });
    return this;
  }
  commit() {
    return this.owner.commit(this.operations);
  }
}

type StorageObjectMetadata = {
  metadata?: Record<string, string>;
  [key: string]: unknown;
};

class SupabaseStorageFile {
  constructor(
    private readonly owner: SupabaseDataService,
    private readonly bucketName: string,
    private readonly path: string,
  ) {}
  async getSignedUrl(options: {
    action: 'read' | 'write';
    expires: number;
    contentType?: string;
  }) {
    const bucket = this.owner.supabase.storage.from(this.bucketName);
    const result =
      options.action === 'read'
        ? await bucket.createSignedUrl(
            this.path,
            Math.max(1, Math.floor((options.expires - Date.now()) / 1000)),
          )
        : await bucket.createSignedUploadUrl(this.path, { upsert: false });
    if (result.error) throw result.error;
    const signed =
      options.action === 'read' ? result.data.signedUrl : result.data.signedUrl;
    const uploadUrl = new URL(signed, this.owner.supabaseUrl).toString();
    return [uploadUrl] as const;
  }
  async save(
    content: Buffer,
    options: {
      resumable?: boolean;
      metadata?: { contentType?: string; metadata?: Record<string, string> };
    },
  ) {
    const result = await this.owner.supabase.storage
      .from(this.bucketName)
      .upload(this.path, content, {
        contentType: options.metadata?.contentType,
        upsert: false,
        metadata: options.metadata?.metadata,
      });
    if (result.error) throw result.error;
    return result.data;
  }
  async getMetadata(): Promise<[StorageObjectMetadata]> {
    const result = await this.owner.supabase.storage
      .from(this.bucketName)
      .list(this.path.split('/').slice(0, -1).join('/'), {
        search: this.path.split('/').pop(),
        limit: 10,
      });
    if (result.error) throw result.error;
    const entry = result.data.find(
      (item) => item.name === this.path.split('/').pop(),
    );
    if (!entry) {
      throw Object.assign(new Error('Storage object not found.'), {
        code: 'NotFound',
      });
    }
    return [{ metadata: entry.metadata as Record<string, string> | undefined }];
  }
  async delete(options?: { ignoreNotFound?: boolean }) {
    const result = await this.owner.supabase.storage
      .from(this.bucketName)
      .remove([this.path]);
    if (result.error && options?.ignoreNotFound !== true) throw result.error;
    return result.data;
  }
}

class SupabaseStorageBucket {
  constructor(
    private readonly owner: SupabaseDataService,
    private readonly name: string,
  ) {}
  file(path: string) {
    return new SupabaseStorageFile(this.owner, this.name, path);
  }
}

class SupabaseStorage {
  constructor(private readonly owner: SupabaseDataService) {}
  bucket(name: string) {
    return new SupabaseStorageBucket(this.owner, name);
  }
}

type SupabaseIdentity = {
  uid: string;
  email?: string;
  email_verified: boolean;
  user_metadata: Record<string, unknown>;
  iat?: number;
};

@Injectable()
export class SupabaseDataService {
  private readonly logger = new Logger(SupabaseDataService.name);
  private client?: SupabaseClient;

  constructor(private readonly config: ConfigService) {}

  get supabase() {
    return this.clientInstance;
  }
  get supabaseUrl() {
    return this.requiredConfig('SUPABASE_URL');
  }
  get auth() {
    return {
      updateUser: async (uid: string, data: { password: string }) => {
        const result = await this.supabase.auth.admin.updateUserById(uid, {
          password: data.password,
        });
        if (result.error) throw result.error;
        return result.data.user;
      },
      revokeRefreshTokens: async (uid: string) => {
        const user = await this.supabase.auth.admin.getUserById(uid);
        if (user.error) throw user.error;
        const metadata = {
          ...user.data.user.app_metadata,
          sessions_revoked_at: Math.floor(Date.now() / 1000),
        };
        const result = await this.supabase.auth.admin.updateUserById(uid, {
          app_metadata: metadata,
        });
        if (result.error) throw result.error;
        return result.data.user;
      },
    };
  }
  get documents() {
    return {
      collection: (name: string) => new DocumentQuery(this, name),
      runTransaction: async <T>(
        callback: (transaction: DocumentTransaction) => Promise<T>,
      ) => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const transaction = new DocumentTransaction(this);
          const result = await callback(transaction);
          try {
            await this.commit(transaction.operations, false, transaction.reads);
            return result;
          } catch (error) {
            if (!this.isConflict(error) || attempt === 4) throw error;
          }
        }
        throw new Error('Supabase transaction retry limit exceeded.');
      },
      batch: () => new DocumentWriteBatch(this),
    };
  }
  get storage() {
    return new SupabaseStorage(this);
  }

  async findProfileByEmail(collection: 'users' | 'adminUsers', email: string) {
    const snapshot = await this.documents
      .collection(collection)
      .where('email', '==', email)
      .limit(1)
      .get();
    return snapshot.empty ? null : snapshot.docs[0];
  }

  async findUserSessionProfile(
    email: string,
  ): Promise<UserSessionProfile | null> {
    const profile = await this.findProfileByEmail('users', email);
    return profile ? this.withUserRelations(profile.id, profile.data()) : null;
  }

  async findUserSessionProfileById(
    userId: string,
  ): Promise<UserSessionProfile | null> {
    const profile = await this.documents.collection('users').doc(userId).get();
    return profile.exists
      ? this.withUserRelations(profile.id, profile.data()!)
      : null;
  }

  private async withUserRelations(
    id: string,
    data: DocumentData,
  ): Promise<UserSessionProfile> {
    const [memberships, entities] = await Promise.all([
      this.documents.collection('memberships').where('userId', '==', id).get(),
      this.documents
        .collection('investorEntities')
        .where('userId', '==', id)
        .get(),
    ]);
    return {
      id,
      ...data,
      memberships: memberships.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
      entities: entities.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    };
  }

  async listUserProfiles(limit = 200) {
    const users = await this.documents
      .collection('users')
      .orderBy('createdAt', 'desc')
      .limit(Math.min(Math.max(limit, 1), 200))
      .get();
    return Promise.all(
      users.docs.map(async (doc) => {
        const [memberships, entities] = await Promise.all([
          this.documents
            .collection('memberships')
            .where('userId', '==', doc.id)
            .get(),
          this.documents
            .collection('investorEntities')
            .where('userId', '==', doc.id)
            .get(),
        ]);
        const user = doc.data();
        return {
          id: doc.id,
          name: String(user.name ?? ''),
          email: String(user.email ?? ''),
          phone: String(user.phone ?? ''),
          locked: user.locked === true,
          investorNumber:
            typeof user.investorNumber === 'string'
              ? user.investorNumber
              : null,
          nonResident: user.nonResident === true,
          createdAt: user.createdAt,
          memberships: memberships.docs.map((row) => ({
            experience: row.get('experience'),
          })),
          entities: entities.docs.map((row) => ({
            entityType: row.get('entityType'),
            verificationStatus: row.get('verificationStatus'),
          })),
        };
      }),
    );
  }

  async setUserLocked(userId: string, locked: boolean, adminId: string) {
    const userRef = this.documents.collection('users').doc(userId);
    const auditRef = this.documents.collection('auditLogs').doc();
    return this.documents.runTransaction(async (transaction) => {
      const user = (await transaction.get(userRef)) as DocumentSnapshot;
      if (!user.exists) return null;
      const updated = { id: user.id, ...user.data(), locked };
      transaction.update(userRef, { locked, updatedAt: new Date() });
      transaction.create(auditRef, {
        actorAdminId: adminId,
        action: locked ? 'user.lock' : 'user.unlock',
        resource: 'user',
        resourceId: userId,
        createdAt: new Date(),
      });
      return updated;
    });
  }

  async createRegisteredUserProfile(profile: RegisteredUserProfile) {
    const userRef = this.documents.collection('users').doc(profile.uid);
    const counterRef = this.documents
      .collection('systemCounters')
      .doc('investorNumber');
    const entityRef = this.documents.collection('investorEntities').doc();
    const membershipRefs = profile.experiences.map(() =>
      this.documents.collection('memberships').doc(),
    );
    const normalizedEmail = profile.email.toLowerCase().trim();

    return this.documents.runTransaction(async (transaction) => {
      const [existingUser, duplicateEmail, counter] = await Promise.all([
        transaction.get(userRef) as Promise<DocumentSnapshot>,
        transaction.get(
          this.documents
            .collection('users')
            .where('email', '==', normalizedEmail)
            .limit(1),
        ) as Promise<QuerySnapshot>,
        transaction.get(counterRef) as Promise<DocumentSnapshot>,
      ]);
      const isPendingSupabaseProfile =
        existingUser.exists &&
        existingUser.get('supabaseUid') === profile.uid &&
        existingUser.get('registrationStatus') === 'pending_verification' &&
        String(existingUser.get('email') ?? '')
          .toLowerCase()
          .trim() === normalizedEmail;
      const hasOtherProfileWithEmail = duplicateEmail.docs.some(
        (document) => document.id !== profile.uid,
      );
      if (
        (existingUser.exists && !isPendingSupabaseProfile) ||
        hasOtherProfileWithEmail
      ) {
        return false;
      }
      let nextNumber =
        typeof counter.get('next') === 'number'
          ? counter.get('next')
          : 1_000_000;
      let investorNumber: string | undefined;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidate = String(nextNumber);
        const used = (await transaction.get(
          this.documents
            .collection('users')
            .where('investorNumber', '==', candidate)
            .limit(1),
        )) as QuerySnapshot;
        nextNumber = nextNumber >= 9_999_999 ? 1_000_000 : nextNumber + 1;
        if (used.empty) {
          investorNumber = candidate;
          break;
        }
      }
      if (!investorNumber)
        throw new Error('Could not allocate a unique investor number.');
      const now = new Date();
      transaction.set(counterRef, { next: nextNumber }, { merge: true });
      const userProfile = {
        id: profile.uid,
        email: normalizedEmail,
        name: profile.name.trim(),
        phone: profile.phone.trim(),
        entity: profile.entity,
        address: '',
        countryCode: profile.countryCode,
        hasProfilePhoto: false,
        nonResident: profile.nonResident,
        investorNumber,
        locked: false,
        supabaseUid: profile.uid,
        authProvider: 'supabase',
        registrationStatus: 'complete',
        createdAt: existingUser.get('createdAt') ?? now,
        updatedAt: now,
      };
      if (isPendingSupabaseProfile) {
        transaction.update(userRef, userProfile);
      } else {
        transaction.create(userRef, userProfile);
      }
      for (const [index, experience] of profile.experiences.entries()) {
        transaction.create(membershipRefs[index], {
          id: membershipRefs[index].id,
          userId: profile.uid,
          experience,
          createdAt: now,
        });
      }
      transaction.create(entityRef, {
        id: entityRef.id,
        userId: profile.uid,
        entityType: profile.entity,
        nonResident: profile.nonResident,
        verificationStatus: 'pending',
        ...(profile.registrationNumber
          ? { registrationNumber: profile.registrationNumber }
          : {}),
        ...(profile.representatives
          ? { representatives: profile.representatives }
          : {}),
        createdAt: now,
        updatedAt: now,
      });
      return true;
    });
  }

  async linkProfile(
    profile: QueryDocumentSnapshot,
    uid: string,
    email: string,
  ) {
    const linkedUid = profile.get('supabaseUid');
    if (typeof linkedUid === 'string' && linkedUid !== uid) return false;
    if (linkedUid !== uid) {
      await profile.ref.set(
        { supabaseUid: uid, authProvider: 'supabase', email },
        { merge: true },
      );
    }
    return true;
  }

  async linkProfileByEmail(
    collection: 'users' | 'adminUsers',
    email: string,
    uid: string,
  ) {
    const profile = await this.findProfileByEmail(collection, email);
    return profile ? this.linkProfile(profile, uid, email) : false;
  }

  async verifyIdToken(token: string): Promise<SupabaseIdentity> {
    const result = await this.supabase.auth.getUser(token);
    if (result.error || !result.data.user) {
      if (result.error?.status === 401 || result.error?.status === 403) {
        throw new UnauthorizedException(
          'Invalid, expired, or revoked Supabase access token.',
        );
      }
      this.logger.error(
        `Supabase access-token verification failed (${result.error?.status ?? 'unknown'}).`,
      );
      throw new ServiceUnavailableException(
        'Supabase Auth is unavailable. Check the backend Supabase configuration.',
      );
    }
    const user = result.data.user;
    const issuedAt = this.getTokenIssuedAt(token);
    const revokedAt = Number(user.app_metadata?.sessions_revoked_at ?? 0);
    if (issuedAt !== undefined && issuedAt <= revokedAt) {
      throw new UnauthorizedException(
        'Invalid, expired, or revoked Supabase access token.',
      );
    }
    return {
      uid: user.id,
      email: user.email,
      email_verified: !!user.email_confirmed_at,
      user_metadata: user.user_metadata ?? {},
      ...(issuedAt === undefined ? {} : { iat: issuedAt }),
    };
  }

  async readDocument(
    collection: string,
    id: string,
  ): Promise<StoredDocument | null> {
    const result = await this.supabase
      .from('developify_documents')
      .select('collection,document_id,data,version')
      .eq('collection', collection)
      .eq('document_id', id)
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data as StoredDocument | null;
  }

  async readQuery(query: DocumentQuery): Promise<QuerySnapshot> {
    const { filters, ordering, limit, countOnly } = query.queryParameters();
    let request = this.supabase
      .from('developify_documents')
      .select(
        'collection,document_id,data,version',
        countOnly ? { count: 'exact', head: true } : undefined,
      )
      .eq('collection', query.collectionName);
    for (const filter of filters) {
      const field = `data->>${filter.field}`;
      if (filter.operator === '==') {
        request = request.eq(field, this.queryValue(filter.value));
      } else if (Array.isArray(filter.value)) {
        request = request.in(
          field,
          filter.value.map((value) => this.queryValue(value)),
        );
      } else {
        throw new Error(
          `Supabase "in" filter requires an array for ${filter.field}.`,
        );
      }
    }
    if (ordering)
      request = request.order(`data->>${ordering.field}`, {
        ascending: ordering.direction === 'asc',
        nullsFirst: false,
      });
    if (!countOnly) request = request.limit(limit);
    const result = await request;
    if (result.error) throw result.error;
    if (countOnly)
      return new QuerySnapshot([], result.count ?? 0, result.count ?? 0);
    const docs = (result.data ?? []).map((row) => {
      const stored = row as StoredDocument;
      return new QueryDocumentSnapshot(
        stored.document_id,
        stored.data,
        new DocumentReference(this, stored.collection, stored.document_id),
        stored.version,
      );
    });
    return new QuerySnapshot(docs);
  }

  async collectionVersion(collection: string) {
    const result = await this.supabase
      .from('developify_collection_versions')
      .select('version')
      .eq('collection', collection)
      .maybeSingle();
    if (result.error) throw result.error;
    return Number(result.data?.version ?? 0);
  }

  async commit(
    operations: Operation[],
    ignoreNotFound = false,
    reads: ReadVersion[] = [],
  ) {
    const payload = operations.map((operation) => ({
      ...operation,
      data:
        operation.data === undefined ? undefined : this.toJson(operation.data),
    }));
    const result = await this.supabase.rpc('developify_commit', {
      p_reads: reads,
      p_operations: payload,
    });
    if (result.error) {
      if (ignoreNotFound && result.error.code === 'P0002') return;
      throw result.error;
    }
  }

  private get clientInstance() {
    if (!this.client) {
      const url = this.requiredConfig('SUPABASE_URL');
      const key = this.requiredConfig('SUPABASE_SERVICE_ROLE_KEY');
      this.client = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
    return this.client;
  }
  private requiredConfig(name: string) {
    const value = this.config.get<string>(name)?.trim();
    if (!value)
      throw new Error(
        `${name} is required to connect the backend to Supabase.`,
      );
    return value;
  }
  private queryValue(value: unknown) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'boolean') return String(value);
    return value;
  }
  private toJson(data: DocumentData): DocumentData {
    return JSON.parse(JSON.stringify(data)) as DocumentData;
  }
  private isConflict(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '40001'
    );
  }
  private getTokenIssuedAt(token: string) {
    try {
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
      ) as { iat?: unknown };
      return typeof payload.iat === 'number' ? payload.iat : undefined;
    } catch {
      throw new UnauthorizedException('Invalid Supabase access token.');
    }
  }
}
