import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCardBalanceDto {
  @ApiProperty({ description: 'ISO currency code' })
  @IsString()
  @MaxLength(3)
  currency!: string;

  @ApiProperty()
  @IsNumber()
  balance!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  creditLimit?: number;
}
