import { Module } from '@nestjs/common';
import { FinanceAnalyticsModule } from './analytics/analytics.module';
import { FinanceBalanceSheetModule } from './balance-sheet/balance-sheet.module';
import { FinanceCatalogModule } from './catalog/catalog.module';
import { FinanceEventsModule } from './events/events.module';
import { FinanceFacade } from './finance.facade';
import { FinanceFxModule } from './fx/fx.module';
import { FinanceIngestionModule } from './ingestion/ingestion.module';
import { FinanceLedgerModule } from './ledger/ledger.module';
import { FinancePlanningModule } from './planning/planning.module';
import { FinanceStatementsModule } from './statements/statements.module';
import { FinanceRecycleBinModule } from './shared/recycle-bin.module';
import { FinanceChatContextModule } from './shared/chat-context.module';
import { FinanceWipeModule } from './shared/wipe-finance.module';

/**
 * Finance composition root — capability modules only; exports façade alone.
 */
@Module({
  imports: [
    FinanceFxModule,
    FinanceEventsModule,
    FinanceCatalogModule,
    FinanceStatementsModule,
    FinancePlanningModule,
    FinanceBalanceSheetModule,
    FinanceAnalyticsModule,
    FinanceLedgerModule,
    FinanceIngestionModule,
    FinanceRecycleBinModule,
    FinanceChatContextModule,
    FinanceWipeModule,
  ],
  providers: [FinanceFacade],
  exports: [FinanceFacade],
})
export class FinanceModule {}
