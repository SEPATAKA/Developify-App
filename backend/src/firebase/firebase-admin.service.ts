import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import {
  FirebaseAuthError,
  getAuth,
  type Auth,
} from 'firebase-admin/auth';
import {
  getFirestore,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';

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

type UserSessionProfile = DocumentData & {
  id: string;
  memberships: DocumentData[];
  entities: DocumentData[];
};

@Injectable()
export class FirebaseAdminService {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private appInstance?: App;

  constructor(private readonly config: ConfigService) {}

  get auth(): Auth {
    return getAuth(this.app);
  }

  get firestore(): Firestore {
    return getFirestore(this.app);
  }

  get storage(): Storage {
    return getStorage(this.app);
  }

  async findProfileByEmail(collection: 'users' | 'adminUsers', email: string) {
    const result = await this.firestore
      .collection(collection)
      .where('email', '==', email)
      .limit(1)
      .get();
    return result.empty ? null : result.docs[0];
  }

  async findUserSessionProfile(
    email: string,
  ): Promise<UserSessionProfile | null> {
    const profile = await this.findProfileByEmail('users', email);
    if (!profile) return null;
    const userId = profile.id;
    const [memberships, entities] = await Promise.all([
      this.firestore.collection('memberships').where('userId', '==', userId).get(),
      this.firestore.collection('investorEntities').where('userId', '==', userId).get(),
    ]);
    return {
      id: userId,
      ...profile.data(),
      memberships: memberships.docs.map((doc) => doc.data()),
      entities: entities.docs.map((doc) => doc.data()),
    };
  }

  async findUserSessionProfileById(
    userId: string,
  ): Promise<UserSessionProfile | null> {
    const profile = await this.firestore.collection('users').doc(userId).get();
    if (!profile.exists) return null;
    const [memberships, entities] = await Promise.all([
      this.firestore.collection('memberships').where('userId', '==', userId).get(),
      this.firestore
        .collection('investorEntities')
        .where('userId', '==', userId)
        .get(),
    ]);
    return {
      id: profile.id,
      ...profile.data(),
      memberships: memberships.docs.map((doc) => doc.data()),
      entities: entities.docs.map((doc) => doc.data()),
    };
  }

  async listUserProfiles(limit = 200) {
    const db = this.firestore;
    const users = await db
      .collection('users')
      .orderBy('createdAt', 'desc')
      .limit(Math.min(Math.max(limit, 1), 200))
      .get();
    const userIds = users.docs.map((doc) => doc.id);
    const chunks: string[][] = [];
    for (let index = 0; index < userIds.length; index += 30) {
      chunks.push(userIds.slice(index, index + 30));
    }
    const [memberships, entities] = await Promise.all([
      Promise.all(
        chunks.map((ids) =>
          db
            .collection('memberships')
            .where('userId', 'in', ids)
            .get(),
        ),
      ),
      Promise.all(
        chunks.map((ids) =>
          db
            .collection('investorEntities')
            .where('userId', 'in', ids)
            .get(),
        ),
      ),
    ]);
    const membershipRows = memberships.flatMap((snapshot) => snapshot.docs);
    const entityRows = entities.flatMap((snapshot) => snapshot.docs);

    return users.docs.map((doc) => {
      const user = doc.data();
      return {
        id: doc.id,
        name: String(user.name ?? ''),
        email: String(user.email ?? ''),
        phone: String(user.phone ?? ''),
        locked: user.locked === true,
        investorNumber:
          typeof user.investorNumber === 'string' ? user.investorNumber : null,
        nonResident: user.nonResident === true,
        createdAt: user.createdAt,
        memberships: membershipRows
          .filter((row) => row.get('userId') === doc.id)
          .map((row) => ({ experience: row.get('experience') })),
        entities: entityRows
          .filter((row) => row.get('userId') === doc.id)
          .map((row) => ({
            entityType: row.get('entityType'),
            verificationStatus: row.get('verificationStatus'),
          })),
      };
    });
  }

  async setUserLocked(userId: string, locked: boolean, adminId: string) {
    const db = this.firestore;
    const userRef = db.collection('users').doc(userId);
    const auditRef = db.collection('auditLogs').doc();
    return db.runTransaction(async (transaction) => {
      const user = await transaction.get(userRef);
      if (!user.exists) return null;
      transaction.update(userRef, { locked, updatedAt: new Date() });
      transaction.create(auditRef, {
        actorAdminId: adminId,
        action: locked ? 'user.lock' : 'user.unlock',
        resource: 'user',
        resourceId: userId,
        createdAt: new Date(),
      });
      return { id: user.id, ...user.data(), locked };
    });
  }

  async createRegisteredUserProfile(profile: RegisteredUserProfile) {
    const db = this.firestore;
    const userRef = db.collection('users').doc(profile.uid);
    const counterRef = db.collection('systemCounters').doc('investorNumber');
    const membershipRefs = profile.experiences.map(() =>
      db.collection('memberships').doc(),
    );
    const entityRef = db.collection('investorEntities').doc();
    const normalizedEmail = profile.email.toLowerCase().trim();

    return db.runTransaction(async (transaction) => {
      const [existingUser, duplicateEmail, counter] = await Promise.all([
        transaction.get(userRef),
        transaction.get(
          db.collection('users').where('email', '==', normalizedEmail).limit(1),
        ),
        transaction.get(counterRef),
      ]);
      if (existingUser.exists || !duplicateEmail.empty) return false;

      let nextNumber =
        typeof counter.get('next') === 'number'
          ? counter.get('next')
          : 1_000_000;
      let investorNumber: string | undefined;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidate = String(nextNumber);
        const used = await transaction.get(
          db.collection('users').where('investorNumber', '==', candidate).limit(1),
        );
        nextNumber = nextNumber >= 9_999_999 ? 1_000_000 : nextNumber + 1;
        if (used.empty) {
          investorNumber = candidate;
          break;
        }
      }
      if (!investorNumber) {
        throw new Error('Could not allocate a unique investor number.');
      }

      const now = new Date();
      transaction.set(counterRef, { next: nextNumber }, { merge: true });
      transaction.create(userRef, {
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
        firebaseUid: profile.uid,
        authProvider: 'firebase',
        createdAt: now,
        updatedAt: now,
      });
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
    const linkedUid = profile.get('firebaseUid');
    if (typeof linkedUid === 'string' && linkedUid !== uid) {
      return false;
    }
    if (linkedUid !== uid) {
      await profile.ref.set(
        { firebaseUid: uid, authProvider: 'firebase', email },
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

  async verifyIdToken(token: string) {
    try {
      return await this.auth.verifyIdToken(token, true);
    } catch (error) {
      if (
        error instanceof FirebaseAuthError &&
        [
          'auth/argument-error',
          'auth/id-token-expired',
          'auth/id-token-revoked',
          'auth/invalid-id-token',
        ].includes(error.code)
      ) {
        throw new UnauthorizedException('Invalid, expired, or revoked Firebase ID token.');
      }

      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : 'unknown';
      this.logger.error(`Firebase ID-token verification failed (${code}).`);
      throw new ServiceUnavailableException(
        'Firebase Admin could not verify this token. Configure valid backend credentials for the Firebase project and restart the API.',
      );
    }
  }

  private get app(): App {
    if (this.appInstance) return this.appInstance;

    const projectId =
      this.config.get<string>('FIREBASE_PROJECT_ID') ??
      this.config.get<string>('GOOGLE_CLOUD_PROJECT');
    if (!projectId) {
      throw new Error('FIREBASE_PROJECT_ID is required for Firebase Admin.');
    }

    const existing = getApps().find((app) => app.name === 'developify');
    if (existing) {
      this.appInstance = existing;
      return existing;
    }

    const serviceAccountJson = this.config.get<string>(
      'FIREBASE_SERVICE_ACCOUNT_JSON',
    );
    const serviceAccountPath = this.config.get<string>(
      'FIREBASE_SERVICE_ACCOUNT_PATH',
    );
    const credential = serviceAccountJson
      ? cert(this.parseServiceAccount(serviceAccountJson, projectId))
      : serviceAccountPath
        ? cert(
            this.parseServiceAccount(
              this.readServiceAccountFile(serviceAccountPath),
              projectId,
            ),
          )
        : applicationDefault();

    this.appInstance = initializeApp(
      { credential, projectId },
      'developify',
    );
    return this.appInstance;
  }

  private readServiceAccountFile(path: string): string {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      throw new Error(
        'Could not read the Firebase service account file configured by FIREBASE_SERVICE_ACCOUNT_PATH.',
      );
    }
  }

  private parseServiceAccount(
    json: string,
    projectId: string,
  ): ServiceAccount {
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      throw new Error('Firebase service account file must contain valid JSON.');
    }

    if (
      typeof value !== 'object' ||
      value === null ||
      !('project_id' in value) ||
      !('client_email' in value) ||
      !('private_key' in value) ||
      value.project_id !== projectId ||
      typeof value.client_email !== 'string' ||
      typeof value.private_key !== 'string'
    ) {
      throw new Error(
        'Firebase service account must belong to FIREBASE_PROJECT_ID.',
      );
    }

    return {
      projectId: value.project_id,
      clientEmail: value.client_email,
      privateKey: value.private_key,
    };
  }
}
