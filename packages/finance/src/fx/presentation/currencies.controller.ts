import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@personal-os/core';
import { RequiresEnabledModule } from '@personal-os/core';
import { ChangeBaseCurrencyUseCase } from '../application/change-base-currency.use-case';
import { GetExchangeRatesUseCase } from '../application/get-exchange-rates.use-case';
import { ExchangeRateHostAdapter } from '../infrastructure/exchange-rate-host.adapter';
import { ChangeBaseCurrencyDto } from './dto/change-base-currency.dto';
import { ExchangeRatesQueryDto } from './dto/exchange-rates-query.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class CurrenciesController {
  constructor(
    private readonly rates: ExchangeRateHostAdapter,
    private readonly getExchangeRates: GetExchangeRatesUseCase,
    private readonly changeBaseCurrency: ChangeBaseCurrencyUseCase,
  ) {}

  @Get('currencies')
  @ApiOperation({
    summary: 'List ISO currencies from cached FX rates or exchangerate.host',
  })
  list() {
    return this.rates.listCurrencies();
  }

  @Get('exchange-rates')
  @ApiOperation({
    summary: 'Market rates for quoted currencies in a base currency',
  })
  exchangeRates(@Query() query: ExchangeRatesQueryDto) {
    return this.getExchangeRates.execute(
      query.base,
      query.quotes.split(','),
      new Date(),
    );
  }

  @Post('base-currency')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Change base currency and rebase stored base amounts',
  })
  setBaseCurrency(
    @CurrentUser('sub') userId: string,
    @Body() dto: ChangeBaseCurrencyDto,
  ) {
    return this.changeBaseCurrency.execute(userId, dto.baseCurrency);
  }
}
