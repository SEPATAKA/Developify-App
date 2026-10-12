import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { FirebaseAdminService } from '../../firebase/firebase-admin.service';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly config: ConfigService,
    private readonly firebase: FirebaseAdminService,
  ) {}

  async createUploadUrl(params: {
    mimeType: string;
    name: string;
    prefix: string;
  }) {
    const bucketName = this.config.get<string>('FIREBASE_STORAGE_BUCKET');
    if (!bucketName) {
      throw new ServiceUnavailableException(
        'FIREBASE_STORAGE_BUCKET must be configured for document uploads.',
      );
    }

    const storageKey = `${params.prefix}/${randomUUID()}-${params.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const [uploadUrl] = await this.firebase.storage
      .bucket(bucketName)
      .file(storageKey)
      .getSignedUrl({
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000,
        contentType: params.mimeType,
      });

    return { storageKey, uploadUrl };
  }
}
