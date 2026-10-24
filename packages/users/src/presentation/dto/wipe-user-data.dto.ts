import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class WipeUserDataDto {
  @ApiProperty({
    type: [String],
    example: ['finance.transactions', 'ai.sessions'],
    description:
      'Data branches to wipe, as returned by GET /users/me/data/branches',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  branches!: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'number' },
    description:
      'Branch counts the user saw. A different count answers 409 without deleting anything.',
  })
  @IsOptional()
  @IsObject()
  expectedCounts?: Record<string, number>;

  @ApiPropertyOptional({
    description:
      'Institution whose accounts to zero and whose credit cards to restore to their limit. Applies only to finance.balances.',
  })
  @IsOptional()
  @IsUUID()
  balanceInstitutionId?: string;
}
