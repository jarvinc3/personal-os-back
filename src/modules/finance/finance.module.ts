import { Module } from '@nestjs/common';
import { FinanceAnalyticsModule } from './analytics/analytics.module';
import { FinanceCatalogModule } from './catalog/catalog.module';
import { FinanceEventsModule } from './events/events.module';
import { FinanceFacade } from './finance.facade';
import { FinanceFxModule } from './fx/fx.module';
import { FinanceIngestionModule } from './ingestion/ingestion.module';
import { FinanceLedgerModule } from './ledger/ledger.module';
import { FinancePlanningModule } from './planning/planning.module';

/**
 * Finance composition root — capability modules only; exports façade alone.
 */
@Module({
  imports: [
    FinanceFxModule,
    FinanceEventsModule,
    FinanceCatalogModule,
    FinancePlanningModule,
    FinanceAnalyticsModule,
    FinanceLedgerModule,
    FinanceIngestionModule,
  ],
  providers: [FinanceFacade],
  exports: [FinanceFacade],
})
export class FinanceModule {}
