import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  FIN_TRANSACTION_STATUSES,
  FIN_TRANSACTION_TYPES,
} from '../../../shared/domain/transaction-status';
import { TRANSACTION_EDITABILITY } from '../../../shared/domain/transaction-edit-policy';
import { TRANSACTION_LINK_KIND } from '../../../shared/domain/transaction-links';
import { OPERATION_TYPE } from '../../../shared/domain/transfer';

const TRANSACTION_ITEM_KIND = {
  OPERATION: 'OPERATION',
} as const;

const TRANSACTION_SOURCES = ['MANUAL', 'EMAIL', 'AI'] as const;

export class PlanningLinkResponseDto {
  @ApiProperty({ enum: Object.values(TRANSACTION_LINK_KIND) })
  kind!: string;

  @ApiProperty()
  targetId!: string;

  @ApiProperty()
  label!: string;
}

export class TransactionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, type: String })
  accountId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  accountName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  cardId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  cardName!: string | null;

  @ApiProperty({ enum: FIN_TRANSACTION_TYPES })
  type!: string;

  @ApiProperty({ example: '1500.00' })
  amount!: string;

  @ApiProperty({ example: '1500.00' })
  ledgerAmount!: string;

  @ApiProperty({ example: '1500.00' })
  amountBaseCurrency!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'DOP' })
  ledgerCurrency?: string | null;

  @ApiProperty({ example: '1.00' })
  exchangeRate!: string;

  @ApiProperty({ nullable: true, type: String })
  merchant!: string | null;

  @ApiProperty({ nullable: true, type: String })
  merchantId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  merchantName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  merchantLogoUrl!: string | null;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ format: 'date-time' })
  transactionDate!: string;

  @ApiProperty({ enum: FIN_TRANSACTION_STATUSES })
  status!: string;

  @ApiProperty({ enum: Object.values(TRANSACTION_EDITABILITY) })
  editable!: string;

  @ApiProperty({ enum: TRANSACTION_SOURCES })
  source!: string;

  @ApiProperty({ nullable: true, type: String })
  categoryId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes!: string | null;

  @ApiProperty({ nullable: true, type: String })
  transferGroupId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  transferToAccountId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  transferToAccountName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  transferToCardId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  transferToCardName!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '1500.00' })
  transferToAmount!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'DOP' })
  transferToCurrency!: string | null;

  @ApiProperty()
  transferEstimated!: boolean;

  @ApiProperty({ nullable: true, type: String })
  institutionLogoUrl!: string | null;

  @ApiProperty({ nullable: true, type: String })
  network!: string | null;

  @ApiProperty({ nullable: true, type: String })
  networkLogoUrl!: string | null;

  @ApiProperty({ nullable: true, type: String })
  transferToInstitutionLogoUrl!: string | null;

  @ApiProperty({ nullable: true, type: String })
  transferToNetwork!: string | null;

  @ApiProperty({ nullable: true, type: String })
  transferToNetworkLogoUrl!: string | null;

  @ApiProperty({ nullable: true, type: String })
  linkedTransactionId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  possibleDuplicateOfId!: string | null;

  @ApiPropertyOptional({
    type: () => PlanningLinkResponseDto,
    nullable: true,
  })
  planningLink?: PlanningLinkResponseDto | null;

  @ApiPropertyOptional({ type: Object, nullable: true })
  aiMetadata?: Record<string, unknown> | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class TransactionOperationLegResponseDto extends TransactionResponseDto {
  @ApiProperty({ nullable: true, type: String, example: 'SOURCE' })
  legRole!: string | null;
}

export class TransactionOperationResponseDto extends TransactionResponseDto {
  @ApiProperty({ enum: Object.values(TRANSACTION_ITEM_KIND) })
  kind!: string;

  @ApiProperty({ enum: Object.values(OPERATION_TYPE) })
  operationType!: string;

  @ApiProperty({ type: () => [TransactionOperationLegResponseDto] })
  legs!: TransactionOperationLegResponseDto[];
}

@ApiExtraModels(TransactionOperationResponseDto, TransactionResponseDto)
export class TransactionPageResponseDto {
  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(TransactionResponseDto) },
        { $ref: getSchemaPath(TransactionOperationResponseDto) },
      ],
    },
  })
  items!: Array<TransactionResponseDto | TransactionOperationResponseDto>;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}
