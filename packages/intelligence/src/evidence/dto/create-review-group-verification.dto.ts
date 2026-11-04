import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { REVIEW_GROUP_VERDICTS } from '../human-verification.constants';
import { HumanVerificationLabelsDto } from './human-verification-labels.dto';

export class CreateReviewGroupVerificationDto extends HumanVerificationLabelsDto {
  @ApiProperty({ enum: REVIEW_GROUP_VERDICTS })
  @IsIn(REVIEW_GROUP_VERDICTS)
  verdict!: (typeof REVIEW_GROUP_VERDICTS)[number];

  @ApiProperty({ example: 'notifications@github.com' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  fromAddress!: string;

  @ApiPropertyOptional({
    description:
      'Huella de la plantilla de asunto del grupo. Null agrupa los correos del remitente sin huella.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  templateFingerprint?: string | null;
}
