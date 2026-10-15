import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ENTITY_REF_TYPES, type EntityRefType } from '@personal-os/core';

export class EntityRefDto {
  @ApiProperty({ enum: ENTITY_REF_TYPES })
  @IsIn(ENTITY_REF_TYPES)
  type!: EntityRefType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}

export class ChatContextDto {
  @ApiProperty({ description: 'Module slug that scopes the session' })
  @IsString()
  @MaxLength(64)
  moduleSlug!: string;

  @ApiPropertyOptional({ description: 'Screen that opened the agent' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  screen?: string;

  @ApiPropertyOptional({ type: EntityRefDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EntityRefDto)
  entityRef?: EntityRefDto;
}
