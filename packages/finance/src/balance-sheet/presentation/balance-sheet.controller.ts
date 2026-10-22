import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { BalanceSheetService } from '../application/balance-sheet.service';

const MONEY_STRING = { type: 'string', example: '1500.00' };

const CURRENCY_SLICE_SCHEMA = {
  type: 'object',
  properties: {
    currency: { type: 'string', example: 'DOP' },
    assets: MONEY_STRING,
    available: MONEY_STRING,
    receivables: MONEY_STRING,
    liabilities: MONEY_STRING,
    netWorth: MONEY_STRING,
  },
};

const BALANCE_SHEET_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    asOf: { type: 'string', format: 'date-time' },
    rateDate: { type: 'string', format: 'date' },
    baseCurrency: { type: 'string', example: 'DOP' },
    global: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['COMPLETE', 'INCOMPLETE'] },
        assets: {
          type: 'object',
          properties: {
            accounts: MONEY_STRING,
            cash: MONEY_STRING,
            receivables: MONEY_STRING,
          },
        },
        liabilities: {
          type: 'object',
          properties: {
            creditCards: { type: 'string', nullable: true },
            loans: MONEY_STRING,
          },
        },
        totalAssets: MONEY_STRING,
        totalLiabilities: { type: 'string', nullable: true },
        netWorth: { type: 'string', nullable: true },
        byCurrency: {
          type: 'array',
          description: 'Native totals per currency; no conversion.',
          items: CURRENCY_SLICE_SCHEMA,
        },
        issues: { type: 'array', items: { type: 'object' } },
      },
    },
    institutions: { type: 'array', items: { type: 'object' } },
    cash: { type: 'object' },
    breakdown: {
      type: 'object',
      description:
        'Product lines grouped by currency. Every total is the sum of its lines; doubtful receivables never add to net worth.',
      properties: {
        byCurrency: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              currency: { type: 'string' },
              accounts: { type: 'array', items: { type: 'object' } },
              cash: { type: 'array', items: { type: 'object' } },
              receivables: { type: 'array', items: { type: 'object' } },
              creditCards: { type: 'array', items: { type: 'object' } },
              loans: { type: 'array', items: { type: 'object' } },
              doubtfulReceivables: {
                type: 'array',
                items: { type: 'object' },
              },
              totals: { type: 'object' },
              totalsBase: { type: 'object' },
            },
          },
        },
        totals: { type: 'object' },
      },
    },
  },
};

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance/balance-sheet')
export class BalanceSheetController {
  constructor(private readonly balanceSheet: BalanceSheetService) {}

  @Get()
  @ApiOperation({
    summary: 'Posición financiera actual en la moneda base',
    description:
      'Snapshot of active accounts, pending receivables, credit-card utilization and loan balances. Receivables overdue more than 90 days are listed as doubtful and do not add to net worth. Both global and each institution expose native byCurrency totals; the breakdown groups one line per product by currency. Missing rates or credit limits return status INCOMPLETE with null netWorth.',
  })
  @ApiOkResponse({
    description: 'Net worth summary plus the atomic breakdown by currency.',
    schema: BALANCE_SHEET_RESPONSE_SCHEMA,
  })
  get(@CurrentUser('sub') userId: string) {
    return this.balanceSheet.getBalanceSheet(userId);
  }
}
