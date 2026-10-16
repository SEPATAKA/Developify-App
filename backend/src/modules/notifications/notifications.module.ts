import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import {
  AdminNotificationsController,
  NotificationsController,
} from './notifications.controller';

@Module({
  providers: [NotificationsService],
  controllers: [NotificationsController, AdminNotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
