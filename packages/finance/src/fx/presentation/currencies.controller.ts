import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequiresEnabledModule } from '@personal-os/core';
import { ExchangeRateHostAdapter } from '../infrastructure/exchange-rate-host.adapter';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class CurrenciesController {
  constructor(private readonly rates: ExchangeRateHostAdapter) {}

  @Get('currencies')
  @ApiOperation({
    summary: 'List ISO currencies from cached FX rates or exchangerate.host',
  })
  list() {
    return this.rates.listCurrencies();
  }
}
