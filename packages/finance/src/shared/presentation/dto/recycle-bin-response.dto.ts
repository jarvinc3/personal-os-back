import { ApiProperty } from '@nestjs/swagger';
import { DELETION_ENTITY } from '../../domain/deletion-snapshot';
import { RECYCLE_BIN_ARCHIVED_TYPES } from '../../domain/recycle-bin';

export class ArchivedEntityResponseDto {
  @ApiProperty({ enum: RECYCLE_BIN_ARCHIVED_TYPES })
  type!: string;

  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ nullable: true, type: String })
  logoUrl!: string | null;
}

export class PendingDeletionResponseDto {
  @ApiProperty({ enum: Object.values(DELETION_ENTITY) })
  type!: string;

  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ nullable: true, type: String })
  logoUrl!: string | null;

  @ApiProperty({ format: 'date-time' })
  deletedAt!: string;

  @ApiProperty()
  sizeBytes!: number;
}

export class RecycleBinResponseDto {
  @ApiProperty({ type: () => [ArchivedEntityResponseDto] })
  archived!: ArchivedEntityResponseDto[];

  @ApiProperty({ type: () => [PendingDeletionResponseDto] })
  items!: PendingDeletionResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}
