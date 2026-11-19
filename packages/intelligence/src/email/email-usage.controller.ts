import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@personal-os/core';
import { EmailUsageService } from './email-usage.service';

const DEFAULT_USAGE_DAYS = 7;
const MAX_USAGE_DAYS = 30;

@ApiTags('intelligence')
@ApiBearerAuth('access-token')
@Controller('intelligence')
export class EmailUsageController {
  constructor(private readonly usage: EmailUsageService) {}

  @Get('email/usage')
  @ApiOperation({
    summary: 'Uso y costo de clasificación por día, hora, banco y tipo',
  })
  @ApiOkResponse({ description: 'Uso agregado y restante de los topes' })
  get(@CurrentUser('sub') userId: string, @Query('days') days?: string) {
    const parsedDays = Number(days);
    const rangeDays =
      Number.isInteger(parsedDays) && parsedDays > 0
        ? Math.min(parsedDays, MAX_USAGE_DAYS)
        : DEFAULT_USAGE_DAYS;
    return this.usage.getUsage({ userId, days: rangeDays });
  }
}
