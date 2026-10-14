import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { CurrencyField } from '../../../shared/presentation/validation.decorators';

export class RecalculateBalanceDto {
  @ApiPropertyOptional({ description: 'Account to recalculate' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Card to recalculate' })
  @IsOptional()
  @IsUUID()
  cardId?: string;

  @ApiPropertyOptional({
    example: 'DOP',
    description: 'Required when cardId is set',
  })
  @CurrencyField()
  currency?: string;
}
