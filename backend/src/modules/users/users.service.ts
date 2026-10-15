import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  DocumentQuery,
  SupabaseDataService,
} from '../../supabase/supabase-data.service';

export type ResolvedInvestorEntity = {
  id: string;
  userId: string;
  entityType: string;
  verificationStatus: string;
  nonResident: boolean;
};

@Injectable()
export class UsersService {
  constructor(private readonly supabase: SupabaseDataService) {}

  private get documents() {
    return this.supabase.documents;
  }

  async getProfile(userId: string) {
    const profile = await this.supabase.findUserSessionProfileById(userId);
    if (!profile) throw new NotFoundException('User profile not found.');
    const userDocument = await this.documents
      .collection('users')
      .doc(userId)
      .get();
    const photoKey = userDocument.get('profilePhotoKey');
    let profilePhotoUrl: string | null = null;
    const bucketName =
      process.env.SUPABASE_STORAGE_BUCKET ?? 'developify-private';
    if (
      typeof photoKey === 'string' &&
      photoKey.startsWith(`profile/avatar/${userId}/`) &&
      bucketName
    ) {
      [profilePhotoUrl] = await this.supabase.storage
        .bucket(bucketName)
        .file(photoKey)
        .getSignedUrl({
          action: 'read',
          expires: Date.now() + 15 * 60 * 1000,
        });
    }
    return {
      id: profile.id,
      name: String(profile.name ?? ''),
      email: String(profile.email ?? ''),
      phone: String(profile.phone ?? ''),
      address: String(profile.address ?? ''),
      entity: String(profile.entities[0]?.entityType ?? 'individual'),
      hasProfilePhoto: profile.hasProfilePhoto === true || !!profilePhotoUrl,
      profilePhotoKey: typeof photoKey === 'string' ? photoKey : null,
      profilePhotoUrl,
      countryCode: String(profile.countryCode ?? 'ZA'),
      nonResident: profile.nonResident === true,
      investorNumber:
        typeof profile.investorNumber === 'string'
          ? profile.investorNumber
          : null,
      experiences: profile.memberships
        .map((membership) => membership.experience)
        .filter(
          (experience): experience is string => typeof experience === 'string',
        ),
    };
  }

  async updateProfile(
    userId: string,
    data: Partial<{
      name: string;
      email: string;
      phone: string;
      address: string;
      countryCode: string;
      hasProfilePhoto: boolean;
      profilePhotoKey: string | null;
      nonResident: boolean;
    }>,
  ) {
    const existing = await this.getProfile(userId);
    if (
      data.email !== undefined &&
      data.email.toLowerCase().trim() !== existing.email.toLowerCase().trim()
    ) {
      throw new BadRequestException(
        'Update your email through Supabase Authentication.',
      );
    }
    const updates: Record<string, string | boolean | null> = {};
    if (typeof data.profilePhotoKey === 'string') {
      await this.assertUploadedFile(
        userId,
        data.profilePhotoKey,
        `profile/avatar/${userId}/`,
      );
      updates.profilePhotoKey = data.profilePhotoKey;
      updates.hasProfilePhoto = true;
    } else if (data.profilePhotoKey === null) {
      updates.profilePhotoKey = null;
      updates.hasProfilePhoto = false;
    }
    for (const key of [
      'name',
      'phone',
      'address',
      'countryCode',
      'nonResident',
    ] as const) {
      const value = data[key];
      if (value === undefined) continue;
      if (
        key === 'nonResident'
          ? typeof value !== 'boolean'
          : typeof value !== 'string'
      ) {
        throw new BadRequestException(`Invalid profile field: ${key}.`);
      }
      updates[key] = value;
    }
    await this.documents
      .collection('users')
      .doc(userId)
      .set({ ...updates, updatedAt: new Date() }, { merge: true });
    return this.getProfile(userId);
  }

  async getPreferences(userId: string) {
    const ref = this.documents.collection('userPreferences').doc(userId);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      const defaults = {
        channels: {},
        topics: {},
        language: 'English (UK)',
      };
      await ref.set({ userId, ...defaults });
      return defaults;
    }
    const preferences = snapshot.data()!;
    return {
      channels: preferences.channels ?? {},
      topics: preferences.topics ?? {},
      language: preferences.language ?? 'English (UK)',
    };
  }

  async updatePreferences(
    userId: string,
    data: {
      channels?: Record<string, boolean>;
      topics?: Record<string, boolean>;
      language?: string;
    },
  ) {
    const existing = await this.getPreferences(userId);
    const updated = {
      channels: data.channels ?? existing.channels,
      topics: data.topics ?? existing.topics,
      language: data.language ?? existing.language,
    };
    await this.documents
      .collection('userPreferences')
      .doc(userId)
      .set({ userId, ...updated, updatedAt: new Date() }, { merge: true });
    return updated;
  }

  async getPayout(userId: string) {
    const payout = await this.documents
      .collection('payoutAccounts')
      .doc(userId)
      .get();
    if (!payout.exists) return null;
    const { userId: _, ...data } = payout.data()!;
    return { id: payout.id, ...data };
  }

  async updatePayout(
    userId: string,
    data: {
      bank: string;
      number: string;
      type: string;
      branchCode: string;
      holder: string;
      proofKey?: string | null;
    },
  ) {
    if (typeof data.proofKey === 'string') {
      await this.assertUploadedFile(
        userId,
        data.proofKey,
        `profile/payout/${userId}/`,
      );
    }
    const ref = this.documents.collection('payoutAccounts').doc(userId);
    const existing = await ref.get();
    await ref.set(
      {
        userId,
        ...data,
        createdAt: existing.get('createdAt') ?? new Date(),
        updatedAt: new Date(),
      },
      { merge: true },
    );
    const saved = await ref.get();
    const { userId: _, ...fields } = saved.data()!;
    return { id: saved.id, ...fields };
  }

  private async assertUploadedFile(
    userId: string,
    storageKey: string,
    requiredPrefix: string,
  ) {
    if (!storageKey.startsWith(requiredPrefix)) {
      throw new BadRequestException('The uploaded file reference is invalid.');
    }
    const bucketName =
      process.env.SUPABASE_STORAGE_BUCKET ?? 'developify-private';
    const file = this.supabase.storage.bucket(bucketName).file(storageKey);
    const [metadata] = await file.getMetadata();
    if (metadata.metadata?.ownerId !== userId) {
      throw new BadRequestException('The uploaded file could not be verified.');
    }
  }

  async getSecurity(userId: string) {
    const ref = this.documents.collection('securityPreferences').doc(userId);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      const defaults = {
        biometrics: {},
        twoFactorEnabled: false,
        previousDevices: [],
      };
      await ref.set({ userId, ...defaults });
      return defaults;
    }
    const security = snapshot.data()!;
    return {
      biometrics: security.biometrics ?? {},
      twoFactorEnabled: security.twoFactorEnabled === true,
      previousDevices: security.previousDevices ?? [],
    };
  }

  async updateSecurity(
    userId: string,
    action: string,
    pin?: string,
    password?: string,
    currentPassword?: string,
    preferences?: {
      biometrics?: Record<string, boolean>;
      twoFactorEnabled?: boolean;
      previousDevices?: string[];
    },
  ) {
    if (action === 'savePreferences') {
      const { biometrics, twoFactorEnabled, previousDevices } =
        preferences ?? {};
      if (
        !biometrics ||
        Object.values(biometrics).some((enabled) => typeof enabled !== 'boolean') ||
        typeof twoFactorEnabled !== 'boolean' ||
        !Array.isArray(previousDevices) ||
        previousDevices.some((device) => typeof device !== 'string')
      ) {
        throw new BadRequestException('Security preferences are invalid.');
      }
      const saved = {
        biometrics,
        twoFactorEnabled,
        previousDevices,
        updatedAt: new Date(),
      };
      await this.documents
        .collection('securityPreferences')
        .doc(userId)
        .set({ userId, ...saved }, { merge: true });
      return {
        biometrics: saved.biometrics,
        twoFactorEnabled: saved.twoFactorEnabled,
        previousDevices: saved.previousDevices,
      };
    }
    if (action === 'setPin') {
      if (!pin || !/^\d{4,12}$/.test(pin)) {
        throw new BadRequestException('PIN must contain 4 to 12 digits.');
      }
      const pinHash = await argon2.hash(pin);
      await this.documents
        .collection('users')
        .doc(userId)
        .set({ pinHash, updatedAt: new Date() }, { merge: true });
      return { ok: true };
    }
    if (action === 'changePassword') {
      if (!password || !currentPassword) {
        throw new BadRequestException('Current and new password required.');
      }
      throw new BadRequestException(
        'Change the password through Supabase Authentication so the current password can be reauthenticated securely.',
      );
    }
    if (action === 'saveBiometrics' || action === 'saveTwoFactor') {
      return this.getSecurity(userId);
    }
    throw new BadRequestException(`Unknown security action: ${action}`);
  }

  async verifyPin(userId: string, pin: string) {
    const user = await this.documents.collection('users').doc(userId).get();
    if (!user.exists) throw new NotFoundException('User profile not found.');
    const pinHash = user.get('pinHash');
    if (typeof pinHash !== 'string' || !pinHash) {
      throw new BadRequestException('Transaction PIN is not set.');
    }
    if (!(await argon2.verify(pinHash, pin))) {
      throw new BadRequestException('Incorrect PIN.');
    }
    return true;
  }

  async resolveEntity(
    userId: string,
    entityType?: string,
  ): Promise<ResolvedInvestorEntity> {
    let query: DocumentQuery = this.documents
      .collection('investorEntities')
      .where('userId', '==', userId);
    const entities = await query.get();
    const matching = entities.docs.filter(
      (entity) => !entityType || entity.get('entityType') === entityType,
    );
    if (matching.length === 0) {
      throw new NotFoundException('Investor entity not found.');
    }
    const sorted = matching.sort((left, right) => {
      const leftDate = left.get('createdAt');
      const rightDate = right.get('createdAt');
      const leftMillis =
        leftDate && typeof leftDate.toMillis === 'function'
          ? leftDate.toMillis()
          : 0;
      const rightMillis =
        rightDate && typeof rightDate.toMillis === 'function'
          ? rightDate.toMillis()
          : 0;
      return leftMillis - rightMillis;
    });
    const entity = sorted[0];
    const data = entity.data();
    if (
      data.userId !== userId ||
      typeof data.entityType !== 'string' ||
      typeof data.verificationStatus !== 'string'
    ) {
      throw new NotFoundException('Investor entity is incomplete.');
    }
    return {
      id: entity.id,
      userId,
      entityType: data.entityType,
      verificationStatus: data.verificationStatus,
      nonResident: data.nonResident === true,
    };
  }
}
