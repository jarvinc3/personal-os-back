import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { ReconciliationsService } from '../application/reconciliations.service';
import { BankChargesQueryDto } from './dto/bank-charges-query.dto';

function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance/analytics')
export class BankChargesController {
  constructor(private readonly reconciliations: ReconciliationsService) {}

  @Get('bank-charges')
  @ApiOperation({ summary: 'Bank charges by month, institution and kind' })
  bankCharges(
    @CurrentUser('sub') userId: string,
    @Query() query: BankChargesQueryDto,
  ) {
    const to = query.to
      ? new Date(`${query.to.slice(0, 10)}T00:00:00.000Z`)
      : new Date();
    const from = query.from
      ? new Date(`${query.from.slice(0, 10)}T00:00:00.000Z`)
      : startOfMonthUtc(to);
    return this.reconciliations.bankCharges(userId, from, to);
  }
}
