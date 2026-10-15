import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  SupabaseAuthTokenDto as SupabaseTokenDto,
  InvestorCompleteDto,
  LandownerRegisterDto,
} from './auth.dto';
import { AuthUser, CurrentUser, Public } from '../common/auth.decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('supabase/session')
  supabaseSession(@Body() body: SupabaseTokenDto) {
    return this.auth.supabaseUserSession(body.idToken);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('admin/supabase-session')
  supabaseAdminSession(@Body() body: SupabaseTokenDto) {
    return this.auth.supabaseAdminSession(body.idToken);
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

  @Post('logout')
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user.supabaseUid);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
