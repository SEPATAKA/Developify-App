import { Global, Module } from '@nestjs/common';
import { SupabaseDataService } from './supabase-data.service';
import { DocumentStoreService } from './document-store.service';

@Global()
@Module({
  providers: [SupabaseDataService, DocumentStoreService],
  exports: [SupabaseDataService, DocumentStoreService],
})
export class SupabaseModule {}