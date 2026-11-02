import { ApiProperty } from '@nestjs/swagger';

export class AiConsentResponseDto {
  @ApiProperty()
  contributeToGlobalKnowledge!: boolean;

  @ApiProperty({ format: 'date-time' })
  contributionConsentAt!: string;
}
