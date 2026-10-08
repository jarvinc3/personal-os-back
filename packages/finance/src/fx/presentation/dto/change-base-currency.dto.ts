import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ChangeBaseCurrencyDto {
  @ApiProperty({ example: 'USD', description: 'New ISO-3 base currency' })
  @IsString()
  baseCurrency!: string;
}
