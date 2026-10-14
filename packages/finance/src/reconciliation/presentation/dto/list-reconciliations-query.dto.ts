import { ApiPropertyOptional } from '@nestjs/swagger';
import { CursorQueryDto } from '@personal-os/core';
import { IsOptional, IsUUID } from 'class-validator';

export class ListReconciliationsQueryDto extends CursorQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cardId?: string;
}
