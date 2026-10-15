import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class IntegrityCheckQueryDto {
  @ApiPropertyOptional({ description: 'Check only this account' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Check only this card' })
  @IsOptional()
  @IsUUID()
  cardId?: string;
}
