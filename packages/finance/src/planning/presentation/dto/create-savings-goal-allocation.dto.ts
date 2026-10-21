import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

const allocationKinds = ['CONTRIBUTION', 'WITHDRAWAL'] as const;

export class CreateSavingsGoalAllocationDto {
  @ApiProperty({ enum: allocationKinds, default: 'CONTRIBUTION' })
  @IsOptional()
  @IsEnum(allocationKinds)
  kind?: (typeof allocationKinds)[number];

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Cuenta de origen cuando es distinta a la cuenta de la meta. El aporte crea la transferencia.',
  })
  @IsOptional()
  @IsUUID()
  fromAccountId?: string;

  @ApiPropertyOptional({
    description:
      'Cuenta que recibe el dinero en un retiro. Obligatoria cuando kind es WITHDRAWAL.',
  })
  @IsOptional()
  @IsUUID()
  toAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  fromTransferGroupId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  transactionId?: string;
}
