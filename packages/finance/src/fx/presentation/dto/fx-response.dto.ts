import { ApiProperty } from '@nestjs/swagger';

export class ExchangeRateResponseDto {
  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ nullable: true, type: String, example: '58.50' })
  rate!: string | null;
}

export class ExchangeRatesResponseDto {
  @ApiProperty({ example: 'DOP' })
  baseCurrency!: string;

  @ApiProperty({ format: 'date', example: '2026-11-01' })
  date!: string;

  @ApiProperty({ type: () => [ExchangeRateResponseDto] })
  rates!: ExchangeRateResponseDto[];
}

export class ChangeBaseCurrencyResponseDto {
  @ApiProperty({ example: 'USD' })
  baseCurrency!: string;

  @ApiProperty({ example: 'DOP' })
  previousBaseCurrency!: string;

  @ApiProperty()
  rebasedTransactions!: number;

  @ApiProperty()
  rebasedBudgets!: number;
}
