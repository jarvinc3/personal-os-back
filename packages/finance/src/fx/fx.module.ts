import { Module } from '@nestjs/common';
import { EXCHANGE_RATE_PORT } from '../shared/application/tokens';
import { ChangeBaseCurrencyUseCase } from './application/change-base-currency.use-case';
import { GetExchangeRatesUseCase } from './application/get-exchange-rates.use-case';
import { ResolveAmountsUseCase } from './application/resolve-amounts.use-case';
import { ResolveUserBaseCurrencyUseCase } from './application/resolve-user-base-currency';
import { ExchangeRateHostAdapter } from './infrastructure/exchange-rate-host.adapter';
import { CurrenciesController } from './presentation/currencies.controller';

@Module({
  controllers: [CurrenciesController],
  providers: [
    ExchangeRateHostAdapter,
    {
      provide: EXCHANGE_RATE_PORT,
      useExisting: ExchangeRateHostAdapter,
    },
    ResolveAmountsUseCase,
    ResolveUserBaseCurrencyUseCase,
    GetExchangeRatesUseCase,
    ChangeBaseCurrencyUseCase,
  ],
  exports: [
    EXCHANGE_RATE_PORT,
    ResolveAmountsUseCase,
    ResolveUserBaseCurrencyUseCase,
  ],
})
export class FinanceFxModule {}
