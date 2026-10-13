import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
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

  async uploadContent(params: {
    contentBase64: string;
    mimeType: string;
    name: string;
    ownerId: string;
    prefix: string;
  }) {
    const bucketName = this.config.get<string>('FIREBASE_STORAGE_BUCKET');
    if (!bucketName) {
      throw new ServiceUnavailableException(
        'FIREBASE_STORAGE_BUCKET must be configured for document uploads.',
      );
    }
    if (
      !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(params.prefix) ||
      !params.name.trim() ||
      params.name.length > 180
    ) {
      throw new BadRequestException('Document metadata is invalid.');
    }
    if (
      !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(
        params.mimeType,
      )
    ) {
      throw new BadRequestException('This document type is not supported.');
    }
    if (
      typeof params.contentBase64 !== 'string' ||
      params.contentBase64.length === 0 ||
      params.contentBase64.length > 7_000_000
    ) {
      throw new BadRequestException('The file must be smaller than 5 MB.');
    }
    const content = Buffer.from(params.contentBase64, 'base64');
    if (
      content.length === 0 ||
      content.length > 5 * 1024 * 1024 ||
      content.toString('base64') !== params.contentBase64
    ) {
      throw new BadRequestException('The uploaded file is invalid or too large.');
    }

    const storageKey = `${params.prefix}/${randomUUID()}-${params.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await this.firebase.storage
      .bucket(bucketName)
      .file(storageKey)
      .save(content, {
        resumable: false,
        metadata: {
          contentType: params.mimeType,
          metadata: { ownerId: params.ownerId },
        },
      });
    return { storageKey, sizeBytes: content.length };
  }

  async deleteUploaded(ownerId: string, storageKey: string) {
    const bucketName = this.config.get<string>('FIREBASE_STORAGE_BUCKET');
    if (!bucketName) {
      throw new ServiceUnavailableException(
        'FIREBASE_STORAGE_BUCKET must be configured to remove uploaded files.',
      );
    }
    if (typeof storageKey !== 'string' || !storageKey.trim()) {
      throw new BadRequestException('A storage key is required.');
    }
    const file = this.firebase.storage.bucket(bucketName).file(storageKey);
    const [metadata] = await file.getMetadata();
    if (metadata.metadata?.ownerId !== ownerId) {
      throw new ForbiddenException('This uploaded file does not belong to you.');
    }
    await file.delete({ ignoreNotFound: true });
    return { ok: true };
  }
}
