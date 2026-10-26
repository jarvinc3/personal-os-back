import { IsBoolean } from 'class-validator';

export class UpdateConsentDto {
  @IsBoolean()
  contributeToGlobalKnowledge!: boolean;
}
