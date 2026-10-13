import { Body, Controller, Delete, Post } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { DocumentsService } from './documents.service';
import { CurrentUser, AuthUser } from '../common/auth.decorators';

class PresignDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  mimeType!: string;

  @IsString()
  @MinLength(1)
  prefix!: string;
}

@Controller('documents')
export class DocumentsController {
  constructor(private documents: DocumentsService) {}

  @Post('upload')
  upload(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      name: string;
      mimeType: string;
      prefix: string;
      contentBase64: string;
    },
  ) {
    return this.documents.uploadContent({
      name: body.name,
      mimeType: body.mimeType,
      prefix: `${body.prefix}/${user.id}`,
      contentBase64: body.contentBase64,
      ownerId: user.id,
    });
  }

  @Post('presign')
  async presign(@CurrentUser() user: AuthUser, @Body() body: PresignDto) {
    return this.documents.createUploadUrl({
      name: body.name,
      mimeType: body.mimeType,
      prefix: `${body.prefix}/${user.id}`,
    });
  }

  @Delete('upload')
  deleteUpload(
    @CurrentUser() user: AuthUser,
    @Body() body: { storageKey: string },
  ) {
    return this.documents.deleteUploaded(user.id, body.storageKey);
  }
}
