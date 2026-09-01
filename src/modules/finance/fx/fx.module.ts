import { Module } from '@nestjs/common';
import { EXCHANGE_RATE_PORT } from '../shared/application/tokens';
import { ResolveAmountsUseCase } from './application/resolve-amounts.use-case';
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
  ],
  exports: [EXCHANGE_RATE_PORT, ResolveAmountsUseCase],
})
export class FinanceFxModule {}
