import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { HUMAN_VERIFICATION_VERDICTS } from '../human-verification.constants';
import { HumanVerificationLabelsDto } from './human-verification-labels.dto';

export class CreateHumanVerificationDto extends HumanVerificationLabelsDto {
  @ApiProperty({ enum: HUMAN_VERIFICATION_VERDICTS })
  @IsIn(HUMAN_VERIFICATION_VERDICTS)
  verdict!: (typeof HUMAN_VERIFICATION_VERDICTS)[number];
}
