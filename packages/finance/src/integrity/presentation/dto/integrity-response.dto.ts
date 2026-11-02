import { ApiProperty } from '@nestjs/swagger';

export class BalanceDriftResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, type: String })
  accountId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  cardId!: string | null;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ nullable: true, type: String })
  name!: string | null;

  @ApiProperty({ example: '1500.00' })
  storedBalance!: string;

  @ApiProperty({ example: '1500.00' })
  expectedBalance!: string;

  @ApiProperty({ example: '0.00' })
  difference!: string;

  @ApiProperty({ format: 'date-time' })
  detectedAt!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  resolvedAt!: string | null;
}

export class IntegrityCheckResponseDto {
  @ApiProperty({ type: () => [BalanceDriftResponseDto] })
  drifts!: BalanceDriftResponseDto[];
}

export class IntegrityRecalculateResponseDto {
  @ApiProperty()
  corrected!: boolean;

  @ApiProperty({ nullable: true, type: String })
  accountId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  cardId!: string | null;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ example: '1500.00' })
  balance!: string;
}
