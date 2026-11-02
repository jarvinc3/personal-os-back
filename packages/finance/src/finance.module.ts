import { Module } from '@nestjs/common';
import { FinanceAnalyticsModule } from './analytics/analytics.module';
import { FinanceBalanceSheetModule } from './balance-sheet/balance-sheet.module';
import { FinanceCatalogModule } from './catalog/catalog.module';
import { FinanceEntitiesModule } from './entities/entities.module';
import { FinanceEventsModule } from './events/events.module';
import { FinanceFacade } from './finance.facade';
import { FinanceFxModule } from './fx/fx.module';
import { FinanceIntegrityModule } from './integrity/integrity.module';
import { FinanceLedgerModule } from './ledger/ledger.module';
import { FinanceMerchantsModule } from './merchants/merchants.module';
import { FinancePlanningModule } from './planning/planning.module';
import { FinanceQuickEntryModule } from './quick-entry/quick-entry.module';
import { FinanceReceivableSharesModule } from './receivable-shares/receivable-shares.module';
import { FinanceReconciliationModule } from './reconciliation/reconciliation.module';
import { FinanceRecurringModule } from './recurring/recurring.module';
import { FinanceRecycleBinModule } from './shared/recycle-bin.module';
import { FinanceWipeModule } from './shared/wipe-finance.module';
import { FinanceStatementsModule } from './statements/statements.module';
import { FinanceSubscriptionsModule } from './subscriptions/subscriptions.module';
import { FinanceAiCapabilities } from './ai/finance-ai-capabilities';
import { FinanceSignalConsumer } from './signals/finance-signal-consumer';
/**
 * Finance composition root — domain capabilities and their AI read provider.
 */
@Module({
  imports: [
    FinanceFxModule,
    FinanceEventsModule,
    FinanceCatalogModule,
    FinanceStatementsModule,
    FinancePlanningModule,
    FinanceBalanceSheetModule,
    FinanceEntitiesModule,
    FinanceAnalyticsModule,
    FinanceLedgerModule,
    FinanceMerchantsModule,
    FinanceRecurringModule,
    FinanceReconciliationModule,
    FinanceIntegrityModule,
    FinanceSubscriptionsModule,
    FinanceQuickEntryModule,
    FinanceReceivableSharesModule,
    FinanceRecycleBinModule,
    FinanceWipeModule,
  ],
  providers: [FinanceFacade, FinanceAiCapabilities, FinanceSignalConsumer],
  exports: [FinanceFacade, FinanceAiCapabilities, FinanceSignalConsumer],
})
export class FinanceModule {}
