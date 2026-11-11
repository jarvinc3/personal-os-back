import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  HUMAN_VERIFICATION_SELECTION_MAX_MESSAGES,
  HUMAN_VERIFICATION_VERDICTS,
} from '../human-verification.constants';
import { HumanVerificationLabelsDto } from './human-verification-labels.dto';

export class CreateReviewSelectionVerificationDto extends HumanVerificationLabelsDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: HUMAN_VERIFICATION_SELECTION_MAX_MESSAGES,
    uniqueItems: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(HUMAN_VERIFICATION_SELECTION_MAX_MESSAGES)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(512, { each: true })
  messageIds!: string[];

  @ApiProperty({ enum: HUMAN_VERIFICATION_VERDICTS })
  @IsIn(HUMAN_VERIFICATION_VERDICTS)
  verdict!: (typeof HUMAN_VERIFICATION_VERDICTS)[number];
}
