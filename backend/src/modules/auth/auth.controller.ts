import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  FirebaseIdTokenDto,
  InvestorCompleteDto,
  LandownerRegisterDto,
  RecoveryRequestDto,
  RecoveryVerifyDto,
  ResetPasswordDto,
} from './auth.dto';
import { AuthUser, CurrentUser, Public } from '../common/auth.decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('firebase/session')
  firebaseSession(@Body() body: FirebaseIdTokenDto) {
    return this.auth.firebaseUserSession(body.idToken);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('admin/firebase-session')
  firebaseAdminSession(@Body() body: FirebaseIdTokenDto) {
    return this.auth.firebaseAdminSession(body.idToken);
  }

  @Public()
  @Post('register/landowner')
  registerLandowner(@Body() body: LandownerRegisterDto) {
    return this.auth.registerLandowner({
      ...body,
      entity: body.entity ?? 'individual',
    });
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register/investor/complete')
  completeInvestorRegistration(@Body() body: InvestorCompleteDto) {
    return this.auth.completeInvestorRegistration(body);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('recovery/request')
  requestRecovery(@Body() body: RecoveryRequestDto) {
    return this.auth.requestRecovery(body.email);
  }

  @Public()
  @Post('recovery/verify')
  verifyRecovery(@Body() body: RecoveryVerifyDto) {
    return this.auth.verifyRecovery(body.email, body.code);
  }

  @Public()
  @Post('recovery/reset')
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.auth.resetPassword(body.challengeId, body.password);
  }

  @Post('logout')
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user.firebaseUid);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
