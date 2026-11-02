import { ApiProperty } from '@nestjs/swagger';

export class InstitutionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    example: 'bank',
    description: 'bank | credit_union | digital_wallet | broker | cash | other',
  })
  type!: string;

  @ApiProperty({ nullable: true, type: String })
  shortName!: string | null;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ nullable: true, type: String })
  domain!: string | null;

  @ApiProperty({ nullable: true, type: String })
  color!: string | null;

  @ApiProperty({ nullable: true, type: String })
  logoUrl!: string | null;

  @ApiProperty({ example: 'DO' })
  country!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({
    description: 'System institutions such as «Efectivo» cannot be edited.',
  })
  isSystem!: boolean;
}

export class InstitutionPageResponseDto {
  @ApiProperty({ type: () => [InstitutionResponseDto] })
  items!: InstitutionResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}
