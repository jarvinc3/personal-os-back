import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { BalanceIntegrityService } from '../application/balance-integrity.service';
import type { IntegrityTarget } from '../infrastructure/integrity.repository';
import { IntegrityCheckQueryDto } from './dto/integrity-check-query.dto';
import { RecalculateBalanceDto } from './dto/recalculate-balance.dto';

type TargetInput = {
  accountId?: string;
  cardId?: string;
  currency?: string;
};

function toIntegrityTarget(input: TargetInput): IntegrityTarget | undefined {
  const hasAccount = Boolean(input.accountId);
  const hasCard = Boolean(input.cardId);
  if (hasAccount && hasCard) {
    throw new BadRequestException('Provide exactly one of accountId or cardId');
  }
  if (hasAccount && input.accountId) {
    return { accountId: input.accountId };
  }
  if (hasCard && input.cardId) {
    return {
      cardId: input.cardId,
      ...(input.currency ? { currency: input.currency } : {}),
    };
  }
  return undefined;
}

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance/integrity')
export class IntegrityController {
  constructor(private readonly integrity: BalanceIntegrityService) {}

  @Get('check')
  @ApiOperation({
    summary: 'Compare stored balances against the confirmed movements',
  })
  check(
    @CurrentUser('sub') userId: string,
    @Query() query: IntegrityCheckQueryDto,
  ) {
    return this.integrity.check(userId, toIntegrityTarget(query));
  }

  @Post('recalculate')
  @ApiOperation({ summary: 'Correct a drifted balance from its movements' })
  recalculate(
    @CurrentUser('sub') userId: string,
    @Body() dto: RecalculateBalanceDto,
  ) {
    const target = toIntegrityTarget(dto);
    if (!target) {
      throw new BadRequestException(
        'Provide exactly one of accountId or cardId',
      );
    }
    return this.integrity.recalculate(userId, target);
  }
}
