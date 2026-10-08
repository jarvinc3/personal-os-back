import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ExchangeRatesQueryDto {
  @ApiProperty({ example: 'DOP', description: 'ISO-3 base currency' })
  @IsString()
  base!: string;

  @ApiProperty({
    example: 'USD,EUR',
    description: 'Comma-separated ISO-3 currency codes',
  })
  @IsString()
  quotes!: string;
}
