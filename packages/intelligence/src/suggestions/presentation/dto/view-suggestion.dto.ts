import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class ViewSuggestionsQueryDto {
  @ApiProperty({
    description: 'Ruta de la vista; la clave no incluye filtros ni entidad',
    example: '/finance/transactions',
  })
  @IsString()
  @Length(1, 300)
  @Matches(/^\//)
  route!: string;

  @ApiPropertyOptional({
    description: 'Vista dentro de la ruta',
    example: 'transactions',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  view?: string;

  @ApiPropertyOptional({
    description: 'Sheet abierto sobre la ruta',
    example: 'filters',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  sheet?: string;
}

export class ViewSuggestionActionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  actionType!: string;

  @ApiProperty()
  targetModule!: string;

  @ApiProperty({ enum: ['AUTO_ALLOWED', 'CONFIRM_REQUIRED', 'FORBIDDEN'] })
  policy!: 'AUTO_ALLOWED' | 'CONFIRM_REQUIRED' | 'FORBIDDEN';

  @ApiProperty({
    enum: ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED'],
  })
  status!: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

  @ApiProperty({ type: Object })
  payload!: Record<string, unknown>;
}

export class ViewSuggestionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  prompt!: string;

  @ApiPropertyOptional({ type: () => ViewSuggestionActionDto, nullable: true })
  action!: ViewSuggestionActionDto | null;
}

export class ViewSuggestionsListDto {
  @ApiProperty({ type: [ViewSuggestionDto] })
  suggestions!: ViewSuggestionDto[];
}

export class ViewSuggestionDismissedDto {
  @ApiProperty()
  dismissed!: boolean;
}
