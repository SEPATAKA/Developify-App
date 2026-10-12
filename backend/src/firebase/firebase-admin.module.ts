import { Global, Module } from '@nestjs/common';
import { FirebaseAdminService } from './firebase-admin.service';
import { FirestoreDataService } from './firestore-data.service';

@Global()
@Module({
  providers: [FirebaseAdminService, FirestoreDataService],
  exports: [FirebaseAdminService, FirestoreDataService],
})
export class FirebaseAdminModule {}