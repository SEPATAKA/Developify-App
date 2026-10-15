import { UnauthorizedException } from '@nestjs/common';

jest.mock('../../supabase/supabase-data.service', () => ({
  SupabaseDataService: class SupabaseDataService {},
}));

import { AuthService } from './auth.service';
import { SupabaseDataService } from '../../supabase/supabase-data.service';

describe('AuthService Supabase signup profile completion', () => {
  function serviceForMetadata(registration: Record<string, unknown> | null) {
    let profile: Record<string, unknown> | null = null;
    const createRegisteredUserProfile = jest.fn(
      async (
        value: Parameters<
          SupabaseDataService['createRegisteredUserProfile']
        >[0],
      ) => {
        profile = {
          id: value.uid,
          name: value.name,
          email: value.email,
          phone: value.phone,
          entity: value.entity,
          countryCode: value.countryCode,
          nonResident: value.nonResident,
          memberships: value.experiences.map((experience: string) => ({
            experience,
          })),
          entities: [{ entityType: value.entity }],
        };
        return true;
      },
    );
    const supabase = {
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'verified-supabase-user',
        email: 'investor@example.test',
        email_verified: true,
        user_metadata: {
          name: 'Amina Dlamini',
          developifyRegistration: registration,
        },
      }),
      findUserSessionProfile: jest.fn(async () => profile),
      createRegisteredUserProfile,
      linkProfileByEmail: jest.fn().mockResolvedValue(true),
    };
    return {
      service: new AuthService(supabase as unknown as SupabaseDataService),
      createRegisteredUserProfile,
      supabase,
    };
  }

  it('creates an investor profile and memberships after verified Supabase sign-in', async () => {
    const { service, createRegisteredUserProfile } = serviceForMetadata({
      type: 'investor',
      phone: '+27 821234567',
      countryCode: 'ZA',
      entity: 'company',
      nonResident: false,
      registrationNumber: '2026/123456/07',
      representatives: [
        { name: 'Amina Dlamini', identityNumber: '8001015009087' },
      ],
    });

    const session = await service.supabaseUserSession('verified-access-token');

    expect(session.user).toMatchObject({
      id: 'verified-supabase-user',
      email: 'investor@example.test',
      name: 'Amina Dlamini',
      entity: 'company',
      experiences: ['investor', 'landowner'],
    });
    expect(createRegisteredUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'verified-supabase-user',
        email: 'investor@example.test',
        registrationNumber: '2026/123456/07',
        representatives: [
          { name: 'Amina Dlamini', identityNumber: '8001015009087' },
        ],
        experiences: ['investor', 'landowner'],
      }),
    );
  });

  it('does not create a profile for verified Supabase users without Developify signup metadata', async () => {
    const { service, createRegisteredUserProfile } = serviceForMetadata(null);

    await expect(
      service.supabaseUserSession('verified-access-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(createRegisteredUserProfile).not.toHaveBeenCalled();
  });

  it('rejects incomplete company signup metadata instead of creating a partial profile', async () => {
    const { service, createRegisteredUserProfile } = serviceForMetadata({
      type: 'investor',
      phone: '+27 821234567',
      countryCode: 'ZA',
      entity: 'company',
      representatives: [],
    });

    await expect(
      service.supabaseUserSession('verified-access-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(createRegisteredUserProfile).not.toHaveBeenCalled();
  });
});
