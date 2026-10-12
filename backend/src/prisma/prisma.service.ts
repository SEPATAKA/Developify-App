
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  // PostgreSQL connection is disabled while migrating to Firebase.
  // Endpoints that still use Prisma will not work until migrated.

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

