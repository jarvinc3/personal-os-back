import { ApiProperty } from '@nestjs/swagger';

export class ProactiveSuggestionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  signalId!: string;

  @ApiProperty()
  signalType!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ type: String, nullable: true })
  actionId!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class ProactiveSuggestionLimitsDto {
  @ApiProperty()
  discarded!: number;

  @ApiProperty({ type: String, nullable: true })
  windowStartedAt!: string | null;
}

export class ProactiveSuggestionsResponseDto {
  @ApiProperty({ type: () => [ProactiveSuggestionDto] })
  suggestions!: ProactiveSuggestionDto[];

  @ApiProperty({ type: () => ProactiveSuggestionLimitsDto })
  limits!: ProactiveSuggestionLimitsDto;
}
