import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomInt } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { FirebaseAdminService } from '../../firebase/firebase-admin.service';
import { MailService } from '../mail/mail.service';

type EntityType = 'individual' | 'company' | 'trust' | 'stokvel';
type Experience = 'investor' | 'landowner';

export type AppUserDto = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  entity: EntityType;
  hasProfilePhoto: boolean;
  countryCode: string;
  nonResident: boolean;
  investorNumber: string | null;
  experiences: Experience[];
};

type RegistrationInput = {
  idToken: string;
  name: string;
  email: string;
  phone: string;
  countryCode?: string;
  entity: EntityType;
  nonResident?: boolean;
  registrationNumber?: string;
  representatives?: { name: string; identityNumber: string }[];
};

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly firebase: FirebaseAdminService,
  ) {}

  async firebaseUserSession(idToken: string) {
    const identity = await this.verifyFirebaseToken(idToken);
    const email = identity.email?.toLowerCase().trim();
    if (!email || identity.email_verified !== true) {
      throw new UnauthorizedException(
        'Verify your email address before signing in.',
      );
    }

    const profile = await this.firebase.findUserSessionProfile(email);
    if (!profile) {
      throw new UnauthorizedException(
        'No Developify user profile exists for this account.',
      );
    }
    if (profile.locked === true) {
      throw new UnauthorizedException(
        'This Developify account is unavailable.',
      );
    }
    if (
      !(await this.firebase.linkProfileByEmail('users', email, identity.uid))
    ) {
      throw new UnauthorizedException(
        'This account is linked to another identity.',
      );
    }

    return {
      user: this.toAppUser(profile, email),
      accessToken: idToken,
    };
  }

  async firebaseAdminSession(idToken: string) {
    const identity = await this.verifyFirebaseToken(idToken);
    const email = identity.email?.toLowerCase().trim();
    if (!email || identity.email_verified !== true) {
      throw new UnauthorizedException(
        'Verify your email address before signing in.',
      );
    }
    const profile = await this.firebase.findProfileByEmail('adminUsers', email);
    if (!profile) {
      throw new UnauthorizedException(
        'This Firebase account is not an authorized admin.',
      );
    }
    const role = profile.get('role');
    if (
      profile.get('locked') === true ||
      typeof role !== 'string' ||
      !['admin', 'ops', 'compliance'].includes(role)
    ) {
      throw new UnauthorizedException('This admin account is unavailable.');
    }
    if (
      !(await this.firebase.linkProfileByEmail(
        'adminUsers',
        email,
        identity.uid,
      ))
    ) {
      throw new UnauthorizedException(
        'This account is linked to another identity.',
      );
    }
    return {
      accessToken: idToken,
      admin: {
        id: profile.id,
        email,
        name: String(profile.get('name') ?? ''),
        role,
      },
    };
  }

  async registerLandowner(input: RegistrationInput) {
    const identity = await this.verifyRegistrationToken(input.idToken, input.email);
    await this.createProfile(identity.uid, input, ['landowner']);
    const profile = await this.firebase.findUserSessionProfileById(identity.uid);
    if (!profile) {
      throw new Error('Registered landowner profile could not be read.');
    }
    return {
      user: this.toAppUser(profile, input.email),
      accessToken: input.idToken,
    };
  }

  async completeInvestorRegistration(input: RegistrationInput) {
    const identity = await this.verifyRegistrationToken(input.idToken, input.email);
    if (identity.email_verified !== true) {
      throw new UnauthorizedException(
        'Verify your email using the Firebase link before continuing.',
      );
    }
    await this.createProfile(identity.uid, input, ['investor', 'landowner']);
    const profile = await this.firebase.findUserSessionProfileById(identity.uid);
    if (!profile) {
      throw new Error('Registered investor profile could not be read.');
    }
    return {
      user: this.toAppUser(profile, input.email),
      accessToken: input.idToken,
    };
  }

  private async createProfile(
    uid: string,
    input: RegistrationInput,
    experiences: Experience[],
  ) {
    const created = await this.firebase.createRegisteredUserProfile({
      uid,
      email: input.email.toLowerCase().trim(),
      name: input.name,
      phone: input.phone,
      countryCode: input.countryCode ?? 'ZA',
      entity: input.entity ?? 'individual',
      nonResident: input.nonResident ?? false,
      experiences,
      registrationNumber: input.registrationNumber,
      representatives: input.representatives,
    });
    if (!created) {
      throw new ConflictException({
        kind: 'conflict',
        message: 'An account with this email already exists.',
        fieldErrors: { email: 'Email is already registered.' },
      });
    }
  }

  async requestRecovery(email: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const profile = await this.firebase.findProfileByEmail(
      'users',
      normalizedEmail,
    );
    const uid = profile?.get('firebaseUid');
    if (typeof uid === 'string' && uid.length > 0) {
      const code = String(randomInt(100000, 999999));
      const challengeId = randomBytes(16).toString('hex');
      const expiresAt = new Date(
        Date.now() +
          Number(this.config.get('OTP_TTL_MINUTES', 15)) * 60 * 1000,
      );
      await this.firebase.firestore
        .collection('authChallenges')
        .doc(challengeId)
        .create({
          email: normalizedEmail,
          uid,
          purpose: 'passwordRecovery',
          codeHash: this.hashToken(code),
          attempts: 0,
          verified: false,
          expiresAt,
          createdAt: new Date(),
        });
      await this.mail.sendOtp(normalizedEmail, code, 'password recovery');
    }
    return { ok: true };
  }

  async verifyRecovery(email: string, code: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const challenges = await this.firebase.firestore
      .collection('authChallenges')
      .where('email', '==', normalizedEmail)
      .get();
    const challenge = challenges.docs
      .filter((doc) => {
        const data = doc.data();
        return (
          data.purpose === 'passwordRecovery' &&
          data.verified !== true &&
          this.toDate(data.expiresAt) > new Date()
        );
      })
      .sort(
        (left, right) =>
          this.toDate(right.get('createdAt')).getTime() -
          this.toDate(left.get('createdAt')).getTime(),
      )[0];
    if (!challenge) {
      throw new BadRequestException({
        kind: 'validation',
        message: 'Recovery code expired or invalid.',
      });
    }

    const accepted = await this.firebase.firestore.runTransaction(
      async (transaction) => {
        const current = await transaction.get(challenge.ref);
        if (!current.exists) return false;
        const data = current.data();
        if (
          !data ||
          data.purpose !== 'passwordRecovery' ||
          data.verified === true ||
          this.toDate(data.expiresAt) <= new Date() ||
          data.attempts >= 5
        ) {
          return false;
        }
        const correct = data.codeHash === this.hashToken(code);
        transaction.update(challenge.ref, {
          attempts: data.attempts + 1,
          ...(correct ? { verified: true } : {}),
        });
        return correct;
      },
    );
    if (!accepted) {
      throw new BadRequestException({
        kind: 'validation',
        message: 'Incorrect or expired recovery code.',
        fieldErrors: { code: 'Incorrect code.' },
      });
    }
    return { challengeId: challenge.id };
  }

  async resetPassword(challengeId: string, password: string) {
    const challengeRef = this.firebase.firestore
      .collection('authChallenges')
      .doc(challengeId);
    const challenge = await challengeRef.get();
    const data = challenge.data();
    if (
      !data ||
      data.purpose !== 'passwordRecovery' ||
      data.verified !== true ||
      this.toDate(data.expiresAt) <= new Date() ||
      typeof data.uid !== 'string'
    ) {
      throw new BadRequestException({
        kind: 'validation',
        message: 'Recovery session is invalid.',
      });
    }
    await this.firebase.auth.updateUser(data.uid, { password });
    await challengeRef.delete();
    return { ok: true };
  }

  async logout(firebaseUid: string) {
    await this.firebase.auth.revokeRefreshTokens(firebaseUid);
    return { ok: true };
  }

  async me(userId: string) {
    const profile = await this.firebase.findUserSessionProfileById(userId);
    if (!profile) {
      throw new UnauthorizedException('Developify profile not found.');
    }
    return this.toAppUser(profile, String(profile.email ?? ''));
  }

  private async verifyFirebaseToken(idToken: string) {
    return this.firebase.verifyIdToken(idToken);
  }

  private async verifyRegistrationToken(idToken: string, email: string) {
    const identity = await this.verifyFirebaseToken(idToken);
    if (
      !identity.email ||
      identity.email.toLowerCase().trim() !== email.toLowerCase().trim()
    ) {
      throw new UnauthorizedException('Firebase account email does not match.');
    }
    return identity;
  }

  private toAppUser(
    profile: {
      id: string;
      name?: unknown;
      email?: unknown;
      phone?: unknown;
      address?: unknown;
      hasProfilePhoto?: unknown;
      countryCode?: unknown;
      nonResident?: unknown;
      investorNumber?: unknown;
      memberships?: { experience?: unknown }[];
      entities?: { entityType?: unknown }[];
    },
    email: string,
  ): AppUserDto {
    const validEntities: EntityType[] = [
      'individual',
      'company',
      'trust',
      'stokvel',
    ];
    const entityValue = profile.entities?.[0]?.entityType;
    const entity =
      typeof entityValue === 'string' &&
      validEntities.includes(entityValue as EntityType)
        ? (entityValue as EntityType)
        : 'individual';
    const validExperiences: Experience[] = ['investor', 'landowner'];
    const experiences = (profile.memberships ?? [])
      .map((membership) => membership.experience)
      .filter(
        (experience): experience is Experience =>
          typeof experience === 'string' &&
          validExperiences.includes(experience as Experience),
      );
    return {
      id: profile.id,
      name: typeof profile.name === 'string' ? profile.name : '',
      email,
      phone: typeof profile.phone === 'string' ? profile.phone : '',
      address: typeof profile.address === 'string' ? profile.address : '',
      entity,
      hasProfilePhoto: profile.hasProfilePhoto === true,
      countryCode:
        typeof profile.countryCode === 'string' ? profile.countryCode : 'ZA',
      nonResident: profile.nonResident === true,
      investorNumber:
        typeof profile.investorNumber === 'string'
          ? profile.investorNumber
          : null,
      experiences,
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private toDate(value: unknown): Date {
    if (value instanceof Date) return value;
    if (value instanceof Timestamp) return value.toDate();
    throw new BadRequestException('Invalid recovery challenge timestamp.');
  }
}
