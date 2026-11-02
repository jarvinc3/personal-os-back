import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { AccountResponseDto } from '../../catalog/presentation/dto/account-response.dto';
import { CardResponseDto } from '../../catalog/presentation/dto/card-response.dto';
import { MerchantResponseDto } from '../../merchants/presentation/dto/merchant-response.dto';
import { BudgetResponseDto } from '../../planning/presentation/dto/budget-response.dto';
import { LoanResponseDto } from '../../planning/presentation/dto/loan-response.dto';
import { ReceivableResponseDto } from '../../planning/presentation/dto/receivable-response.dto';
import { SavingsGoalResponseDto } from '../../planning/presentation/dto/savings-goal-response.dto';
import { CategoryResponseDto } from '../../shared/presentation/dto/category-response.dto';
import { TransactionResponseDto } from '../../shared/presentation/dto/transaction-response.dto';
import { SubscriptionResponseDto } from '../../subscriptions/presentation/dto/subscription-response.dto';
import { FinanceEntityLookupService } from '../application/finance-entity-lookup.service';
import { LookupEntitiesDto } from './dto/lookup-entities.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@ApiExtraModels(
  TransactionResponseDto,
  AccountResponseDto,
  CardResponseDto,
  LoanResponseDto,
  BudgetResponseDto,
  SavingsGoalResponseDto,
  ReceivableResponseDto,
  SubscriptionResponseDto,
  MerchantResponseDto,
  CategoryResponseDto,
)
@Controller('finance/entities')
export class EntitiesController {
  constructor(private readonly lookup: FinanceEntityLookupService) {}

  @Post('lookup')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resuelve entidades de Finanzas por referencia, en lote',
    description:
      'Returns the same public representation as each entity endpoint, in the same order as the references. A reference the user cannot see, or that no longer exists, comes back as null in its position. Read-only: it does not record activity.',
  })
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        nullable: true,
        oneOf: [
          { $ref: getSchemaPath(TransactionResponseDto) },
          { $ref: getSchemaPath(AccountResponseDto) },
          { $ref: getSchemaPath(CardResponseDto) },
          { $ref: getSchemaPath(LoanResponseDto) },
          { $ref: getSchemaPath(BudgetResponseDto) },
          { $ref: getSchemaPath(SavingsGoalResponseDto) },
          { $ref: getSchemaPath(ReceivableResponseDto) },
          { $ref: getSchemaPath(SubscriptionResponseDto) },
          { $ref: getSchemaPath(MerchantResponseDto) },
          { $ref: getSchemaPath(CategoryResponseDto) },
        ],
      },
    },
  })
  lookupEntities(
    @CurrentUser('sub') userId: string,
    @Body() dto: LookupEntitiesDto,
  ) {
    return this.lookup.lookup(userId, dto.refs);
  }
}
