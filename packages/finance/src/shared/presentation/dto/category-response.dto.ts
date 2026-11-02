import { ApiProperty } from '@nestjs/swagger';

const FIN_CATEGORY_TYPES = ['EXPENSE', 'INCOME'] as const;

export class CategorySummaryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  color!: string | null;

  @ApiProperty({ nullable: true, type: String })
  icon!: string | null;
}

export class CategoryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, type: String })
  userId!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  icon!: string | null;

  @ApiProperty({ nullable: true, type: String })
  color!: string | null;

  @ApiProperty({ nullable: true, type: String })
  parentId!: string | null;

  @ApiProperty()
  isSystem!: boolean;

  @ApiProperty({ nullable: true, type: String })
  systemKind!: string | null;

  @ApiProperty({ enum: FIN_CATEGORY_TYPES })
  type!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
