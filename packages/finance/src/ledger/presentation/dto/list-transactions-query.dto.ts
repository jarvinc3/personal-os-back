import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../../../core/pagination/pagination.dto';

export class ListTransactionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  transferGroupId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cardId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: ['DEBIT', 'CREDIT', 'TRANSFER'] })
  @IsOptional()
  @IsEnum(['DEBIT', 'CREDIT', 'TRANSFER'])
  type?: 'DEBIT' | 'CREDIT' | 'TRANSFER';

  @ApiPropertyOptional({
    enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'DECLINED', 'REVERSED'],
  })
  @IsOptional()
  @IsEnum(['PENDING', 'CONFIRMED', 'CANCELLED', 'DECLINED', 'REVERSED'])
  status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'DECLINED' | 'REVERSED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => String)
  @IsString()
  search?: string;
}
