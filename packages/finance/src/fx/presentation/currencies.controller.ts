import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Timeout } from '@personal-os/core';
import { RequiresEnabledModule } from '@personal-os/core';
import {
  CHANGE_BASE_CURRENCY_TIMEOUT_MS,
  ChangeBaseCurrencyUseCase,
} from '../application/change-base-currency.use-case';
import { GetExchangeRatesUseCase } from '../application/get-exchange-rates.use-case';
import { ExchangeRateHostAdapter } from '../infrastructure/exchange-rate-host.adapter';
import { ChangeBaseCurrencyDto } from './dto/change-base-currency.dto';
import { ExchangeRatesQueryDto } from './dto/exchange-rates-query.dto';
import {
  ChangeBaseCurrencyResponseDto,
  ExchangeRatesResponseDto,
} from './dto/fx-response.dto';

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
    summary: 'Lista las monedas ISO desde tasas en caché o exchangerate.host',
  })
  @ApiOkResponse({ type: [String] })
  list() {
    return this.rates.listCurrencies();
  }

  @Get('exchange-rates')
  @ApiOperation({
    summary: 'Tasas de mercado de las monedas cotizadas en una moneda base',
  })
  @ApiOkResponse({ type: ExchangeRatesResponseDto })
  exchangeRates(@Query() query: ExchangeRatesQueryDto) {
    return this.getExchangeRates.execute(
      query.base,
      query.quotes.split(','),
      new Date(),
    );
  }

  @Post('base-currency')
  @HttpCode(200)
  @Timeout(CHANGE_BASE_CURRENCY_TIMEOUT_MS)
  @ApiOperation({
    summary: 'Cambia la moneda base y reconvierte los montos base guardados',
  })
  @ApiOkResponse({ type: ChangeBaseCurrencyResponseDto })
  setBaseCurrency(
    @CurrentUser('sub') userId: string,
    @Body() dto: ChangeBaseCurrencyDto,
  ) {
    return this.changeBaseCurrency.execute(userId, dto.baseCurrency);
  }
}
