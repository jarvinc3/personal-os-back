import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  TRANSACTION_LINK_KIND,
  type TransactionLinkKind,
} from '../../../shared/domain/transaction-links';

const linkKinds = Object.values(TRANSACTION_LINK_KIND);

export class LinkTransactionDto {
  @ApiProperty({ enum: linkKinds })
  @IsIn(linkKinds)
  kind!: TransactionLinkKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  loanId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  installmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  receivableId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  goalId?: string;
}
