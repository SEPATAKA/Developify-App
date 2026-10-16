import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseDataService } from '../../supabase/supabase-data.service';

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
  constructor(private readonly supabase: SupabaseDataService) {}

  async supabaseUserSession(idToken: string) {
    const identity = await this.verifySupabaseToken(idToken);
    const email = identity.email?.toLowerCase().trim();
    if (!email || identity.email_verified !== true) {
      throw new UnauthorizedException(
        'Verify your email address before signing in.',
      );
    }

    let profile = await this.supabase.findUserSessionProfile(email);
    if (!profile || profile.registrationStatus === 'pending_verification') {
      const registration = this.registrationFromMetadata(identity, email);
      if (!registration) {
        throw new UnauthorizedException(
          profile
            ? 'The pending Developify profile is incomplete.'
            : 'No Developify user profile exists for this account.',
        );
      }
      await this.createProfile(
        identity.uid,
        registration.input,
        registration.experiences,
      );
      profile = await this.supabase.findUserSessionProfile(email);
      if (!profile || profile.id !== identity.uid) {
        throw new ConflictException(
          'The verified account profile could not be created.',
        );
      }
    }
    if (profile.locked === true) {
      throw new UnauthorizedException(
        'This Developify account is unavailable.',
      );
    }
    if (
      !(await this.supabase.linkProfileByEmail('users', email, identity.uid))
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

  async supabaseAdminSession(idToken: string) {
    const identity = await this.verifySupabaseToken(idToken);
    const email = identity.email?.toLowerCase().trim();
    if (!email || identity.email_verified !== true) {
      throw new UnauthorizedException(
        'Verify your email address before signing in.',
      );
    }
    const profile = await this.supabase.findProfileByEmail('adminUsers', email);
    if (!profile) {
      throw new UnauthorizedException(
        'This Supabase account is not an authorized admin.',
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
      !(await this.supabase.linkProfileByEmail(
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
    const identity = await this.verifyRegistrationToken(
      input.idToken,
      input.email,
    );
    await this.createProfile(identity.uid, input, ['landowner']);
    const profile = await this.supabase.findUserSessionProfileById(
      identity.uid,
    );
    if (!profile) {
      throw new Error('Registered landowner profile could not be read.');
    }
    return {
      user: this.toAppUser(profile, input.email),
      accessToken: input.idToken,
    };
  }

  async completeInvestorRegistration(input: RegistrationInput) {
    const identity = await this.verifyRegistrationToken(
      input.idToken,
      input.email,
    );
    if (identity.email_verified !== true) {
      throw new UnauthorizedException(
        'Verify your email using the Supabase link before continuing.',
      );
    }
    await this.createProfile(identity.uid, input, ['investor', 'landowner']);
    const profile = await this.supabase.findUserSessionProfileById(
      identity.uid,
    );
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
    const created = await this.supabase.createRegisteredUserProfile({
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

  async logout(supabaseUid: string) {
    await this.supabase.auth.revokeRefreshTokens(supabaseUid);
    return { ok: true };
  }

  async me(userId: string) {
    const profile = await this.supabase.findUserSessionProfileById(userId);
    if (!profile) {
      throw new UnauthorizedException('Developify profile not found.');
    }
    return this.toAppUser(profile, String(profile.email ?? ''));
  }

  private async verifySupabaseToken(idToken: string) {
    return this.supabase.verifyIdToken(idToken);
  }

  private registrationFromMetadata(
    identity: Awaited<ReturnType<SupabaseDataService['verifyIdToken']>>,
    email: string,
  ): { input: RegistrationInput; experiences: Experience[] } | null {
    const registration = identity.user_metadata.developifyRegistration;
    if (!registration || typeof registration !== 'object') return null;
    const metadata = registration as Record<string, unknown>;
    const type = metadata.type;
    const entity = metadata.entity;
    const name = metadata.name ?? identity.user_metadata.name;
    const phone = metadata.phone;
    const countryCode = metadata.countryCode;
    const entities: EntityType[] = [
      'individual',
      'company',
      'trust',
      'stokvel',
    ];
    if (
      (type !== 'investor' && type !== 'landowner') ||
      typeof name !== 'string' ||
      !name.trim() ||
      typeof phone !== 'string' ||
      !phone.trim() ||
      typeof entity !== 'string' ||
      !entities.includes(entity as EntityType) ||
      (countryCode !== undefined && typeof countryCode !== 'string')
    ) {
      return null;
    }
    const representatives = metadata.representatives;
    if (
      representatives !== undefined &&
      (!Array.isArray(representatives) ||
        representatives.length > 20 ||
        representatives.some(
          (value) =>
            !value ||
            typeof value !== 'object' ||
            typeof (value as Record<string, unknown>).name !== 'string' ||
            typeof (value as Record<string, unknown>).identityNumber !==
              'string',
        ))
    ) {
      return null;
    }
    if (
      type === 'investor' &&
      entity === 'company' &&
      (typeof metadata.registrationNumber !== 'string' ||
        !metadata.registrationNumber.trim() ||
        !Array.isArray(representatives) ||
        representatives.length === 0)
    ) {
      return null;
    }
    const input: RegistrationInput = {
      idToken: '',
      name: name.trim(),
      email,
      phone: phone.trim(),
      countryCode:
        typeof countryCode === 'string' && countryCode.trim()
          ? countryCode.trim()
          : 'ZA',
      entity: entity as EntityType,
      nonResident: metadata.nonResident === true,
      ...(typeof metadata.registrationNumber === 'string'
        ? { registrationNumber: metadata.registrationNumber.trim() }
        : {}),
      ...(Array.isArray(representatives)
        ? {
            representatives: representatives as {
              name: string;
              identityNumber: string;
            }[],
          }
        : {}),
    };
    return {
      input,
      experiences:
        type === 'investor' ? ['investor', 'landowner'] : ['landowner'],
    };
  }

  private async verifyRegistrationToken(idToken: string, email: string) {
    const identity = await this.verifySupabaseToken(idToken);
    if (
      !identity.email ||
      identity.email.toLowerCase().trim() !== email.toLowerCase().trim()
    ) {
      throw new UnauthorizedException('Supabase account email does not match.');
    }
    if (identity.email_verified !== true) {
      throw new UnauthorizedException(
        'Verify your email address before continuing.',
      );
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
}
