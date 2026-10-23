import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import {
  FINANCE_ENTITY_TYPES,
  MAX_ENTITY_REFS,
  type FinanceEntityType,
} from '../../domain/entity-reference';

export class EntityReferenceDto {
  @ApiProperty({
    enum: FINANCE_ENTITY_TYPES,
    description: 'Finance product the reference points at',
  })
  @IsIn(FINANCE_ENTITY_TYPES)
  type!: FinanceEntityType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}

export class LookupEntitiesDto {
  @ApiProperty({
    type: [EntityReferenceDto],
    description: `References to resolve, at most ${MAX_ENTITY_REFS} per call`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ENTITY_REFS)
  @ValidateNested({ each: true })
  @Type(() => EntityReferenceDto)
  refs!: EntityReferenceDto[];
}
