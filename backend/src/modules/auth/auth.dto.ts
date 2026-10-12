import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const entityTypes = ['individual', 'company', 'trust', 'stokvel'];
type EntityType = 'individual' | 'company' | 'trust' | 'stokvel';

class InvestorRepresentativeDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  identityNumber!: string;
}

export class FirebaseIdTokenDto {
  @IsString()
  @MinLength(20)
  idToken!: string;
}

export class LandownerRegisterDto extends FirebaseIdTokenDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  phone!: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsIn(entityTypes)
  entity?: EntityType;
}

export class InvestorCompleteDto extends FirebaseIdTokenDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  phone!: string;

  @IsIn(entityTypes)
  entity!: EntityType;

  @IsOptional()
  @IsBoolean()
  nonResident?: boolean;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => InvestorRepresentativeDto)
  representatives?: InvestorRepresentativeDto[];
}

export class RecoveryRequestDto {
  @IsEmail()
  email!: string;
}

export class RecoveryVerifyDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(4)
  code!: string;
}

export class ResetPasswordDto {
  @IsString()
  challengeId!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
