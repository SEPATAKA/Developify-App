import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import type { Request } from 'express';
import { FirebaseAdminService } from '../../firebase/firebase-admin.service';
import { AuthUser } from './auth.decorators';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly firebase: FirebaseAdminService) {
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

    const identity = await this.firebase.verifyIdToken(token);

    const email = identity.email?.toLowerCase().trim();
    if (!email || identity.email_verified !== true) {
      throw new UnauthorizedException('Verified Firebase email required.');
    }

    const userProfile = await this.firebase.findProfileByEmail('users', email);
    if (
      userProfile?.get('firebaseUid') === identity.uid &&
      userProfile.get('locked') !== true
    ) {
      return {
        id: userProfile.id,
        email,
        type: 'user',
        firebaseUid: identity.uid,
      };
    }

    const adminProfile = await this.firebase.findProfileByEmail(
      'adminUsers',
      email,
    );
    const role = adminProfile?.get('role');
    if (
      adminProfile?.get('firebaseUid') === identity.uid &&
      adminProfile.get('locked') !== true &&
      typeof role === 'string' &&
      ['admin', 'ops', 'compliance'].includes(role)
    ) {
      return {
        id: adminProfile.id,
        email,
        type: 'admin',
        role,
        firebaseUid: identity.uid,
      };
    }

    throw new UnauthorizedException(
      'No active Developify profile is linked to this identity.',
    );
  }
}
