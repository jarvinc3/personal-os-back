import { ApiProperty } from '@nestjs/swagger';

export class BankChargesMonthResponseDto {
  @ApiProperty({ example: '2026-11' })
  month!: string;

  @ApiProperty({ example: '1500.00' })
  total!: string;

  @ApiProperty()
  count!: number;
}

export class BankChargesInstitutionResponseDto {
  @ApiProperty()
  name!: string;

  @ApiProperty({ example: '1500.00' })
  total!: string;

  @ApiProperty()
  count!: number;
}

export class BankChargesKindResponseDto {
  @ApiProperty()
  kind!: string;

  @ApiProperty({ example: '1500.00' })
  total!: string;

  @ApiProperty()
  count!: number;
}

export class BankChargesResponseDto {
  @ApiProperty({ format: 'date' })
  from!: string;

  @ApiProperty({ format: 'date' })
  to!: string;

  @ApiProperty({ example: '1500.00' })
  total!: string;

  @ApiProperty()
  count!: number;

  @ApiProperty({ type: () => [BankChargesMonthResponseDto] })
  byMonth!: BankChargesMonthResponseDto[];

  @ApiProperty({ type: () => [BankChargesInstitutionResponseDto] })
  byInstitution!: BankChargesInstitutionResponseDto[];

  @ApiProperty({ type: () => [BankChargesKindResponseDto] })
  byKind!: BankChargesKindResponseDto[];
}
