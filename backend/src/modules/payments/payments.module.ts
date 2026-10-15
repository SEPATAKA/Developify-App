import { Module } from '@nestjs/common';
import { ManualPaymentProvider, PaymentService } from './payment.service';
import { PaystackPaymentProvider } from './paystack-payment.provider';

@Module({
  providers: [ManualPaymentProvider, PaystackPaymentProvider, PaymentService],
  exports: [PaymentService, ManualPaymentProvider, PaystackPaymentProvider],
})
export class PaymentsModule {}
