import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { WalletService } from './wallet.service';
import {
  AuthUser,
  CurrentUser,
  Public,
  Roles,
} from '../common/auth.decorators';
import { PaymentService } from '../payments/payment.service';

@Controller()
export class WalletController {
  constructor(
    private wallet: WalletService,
    private payments: PaymentService,
  ) {}

  @Public()
  @Post('wallet/paystack/webhook')
  @HttpCode(HttpStatus.OK)
  async paystackWebhook(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-paystack-signature') signature?: string,
    @Body() body?: Record<string, unknown>,
  ) {
    this.payments.paystackTestProvider.verifyWebhookSignature(
      request.rawBody ?? Buffer.alloc(0),
      signature,
    );
    if (body?.event !== 'charge.success') return { received: true };
    const data = body.data;
    if (
      typeof data !== 'object' ||
      data === null ||
      !('reference' in data) ||
      typeof data.reference !== 'string'
    ) {
      throw new BadRequestException('Paystack payment reference is missing.');
    }
    await this.wallet.confirmPaystackDeposit(data.reference);
    return { received: true };
  }

  @Public()
  @Get('wallet/paystack/callback')
  async paystackCallback(
    @Query('reference') reference: string | undefined,
    @Res() response: Response,
  ) {
    if (!reference?.trim()) {
      throw new BadRequestException('Paystack payment reference is missing.');
    }
    await this.wallet.confirmPaystackDeposit(reference.trim());
    return response
      .status(HttpStatus.OK)
      .type('html')
      .send(
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Payment complete</title><body><h1>Payment verified</h1><p>Your wallet has been updated. Return to the Developify app.</p></body></html>',
      );
  }

  @Get('wallet/balance')
  balance(@CurrentUser() user: AuthUser, @Query('entity') entity?: string) {
    return this.wallet.balance(user.id, entity);
  }

  @Get('wallet/snapshot')
  snapshot(@CurrentUser() user: AuthUser, @Query('entity') entity?: string) {
    return this.wallet.snapshot(user.id, entity);
  }

  @Get('wallet/transactions/:id')
  transaction(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('entity') entity?: string,
  ) {
    return this.wallet.getTransaction(user.id, id, entity);
  }

  @Get('wallet/investments/:id')
  investment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('entity') entity?: string,
  ) {
    return this.wallet.getInvestment(user.id, id, entity);
  }

  @Post('wallet/add-money')
  addMoney(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      amountCents: number;
      methodId: string;
      operationId: string;
      pin: string;
      entity?: string;
    },
  ) {
    return this.wallet.addMoney({
      userId: user.id,
      amountCents: body.amountCents,
      methodId: body.methodId,
      operationId: body.operationId,
      pin: body.pin,
      entityType: body.entity,
    });
  }

  @Post('wallet/withdraw')
  withdraw(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      amountCents: number;
      methodId: string;
      operationId: string;
      pin: string;
      entity?: string;
    },
  ) {
    return this.wallet.withdraw({
      userId: user.id,
      amountCents: body.amountCents,
      methodId: body.methodId,
      operationId: body.operationId,
      pin: body.pin,
      entityType: body.entity,
    });
  }

  @Post('wallet/payment-methods/bank')
  addBank(@CurrentUser() user: AuthUser, @Body() body: Record<string, string>) {
    return this.wallet.addBankAccount(user.id, body as never);
  }

  @Post('wallet/payment-methods/card')
  addCard() {
    return this.wallet.addCard();
  }

  @Delete('wallet/payment-methods/:id')
  removeMethod(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('entity') entity?: string,
  ) {
    return this.wallet.removePaymentMethod(user.id, id, entity);
  }

  @Patch('wallet/payment-methods/:id/default')
  setDefault(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { isDefault: boolean; entity?: string },
  ) {
    return this.wallet.setDefaultPaymentMethod(
      user.id,
      id,
      body.isDefault,
      body.entity,
    );
  }

  @Post('wallet/notifications/read')
  markRead(@CurrentUser() user: AuthUser, @Body() body: { id?: string }) {
    return this.wallet.markNotificationsRead(user.id, body.id);
  }

  @Roles('admin', 'ops')
  @Post('admin/wallet/deposits/:id/confirm')
  confirmDeposit(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    return this.wallet.confirmDeposit(admin.id, id);
  }

  @Roles('admin', 'ops')
  @Post('admin/wallet/withdrawals/:id/approve')
  approveWithdrawal(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    return this.wallet.approveWithdrawal(admin.id, id);
  }
}
