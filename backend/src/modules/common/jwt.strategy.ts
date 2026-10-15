import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import type { Request } from 'express';
import { SupabaseDataService } from '../../supabase/supabase-data.service';
import { AuthUser } from './auth.decorators';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly supabase: SupabaseDataService) {
    super();
  }

  async validate(request: Request): Promise<AuthUser> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication required.');
    }

    const token = authorization.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Authentication required.');
    }

    const identity = await this.supabase.verifyIdToken(token);

    const email = identity.email?.toLowerCase().trim();
    if (!email || identity.email_verified !== true) {
      throw new UnauthorizedException('Verified Supabase email required.');
    }

    const userProfile = await this.supabase.findProfileByEmail('users', email);
    if (
      userProfile?.get('supabaseUid') === identity.uid &&
      userProfile.get('locked') !== true
    ) {
      return {
        id: userProfile.id,
        email,
        type: 'user',
        supabaseUid: identity.uid,
      };
    }

    const adminProfile = await this.supabase.findProfileByEmail(
      'adminUsers',
      email,
    );
    const role = adminProfile?.get('role');
    if (
      adminProfile?.get('supabaseUid') === identity.uid &&
      adminProfile.get('locked') !== true &&
      typeof role === 'string' &&
      ['admin', 'ops', 'compliance'].includes(role)
    ) {
      return {
        id: adminProfile.id,
        email,
        type: 'admin',
        role,
        supabaseUid: identity.uid,
      };
    }

    throw new UnauthorizedException(
      'No active Developify profile is linked to this identity.',
    );
  }
}
