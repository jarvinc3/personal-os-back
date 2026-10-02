import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  RequiresEnabledModule,
} from '../../../../core/decorators';
import { BalanceSheetService } from '../application/balance-sheet.service';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance/balance-sheet')
export class BalanceSheetController {
  constructor(private readonly balanceSheet: BalanceSheetService) {}

  @Get()
  @ApiOperation({
    summary: 'Current financial position in BASE_CURRENCY',
    description:
      'Snapshot of active accounts minus credit-card utilization and loan balances. Credit debt is creditLimit - available balance. Missing credit limits return status INCOMPLETE with null netWorth.',
  })
  get(@CurrentUser('sub') userId: string) {
    return this.balanceSheet.getBalanceSheet(userId);
  }
}
