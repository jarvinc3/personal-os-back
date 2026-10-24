import { Module } from '@nestjs/common';
import { FinanceCatalogModule } from '../catalog/catalog.module';
import { FinanceLedgerModule } from '../ledger/ledger.module';
import { FinanceMerchantsModule } from '../merchants/merchants.module';
import { FinancePlanningModule } from '../planning/planning.module';
import { FinanceSubscriptionsModule } from '../subscriptions/subscriptions.module';
import { FinanceEntityLookupService } from './application/finance-entity-lookup.service';
import { EntitiesController } from './presentation/entities.controller';

/** Bulk read of finance products with the shape of their own endpoints. */
@Module({
  imports: [
    FinanceCatalogModule,
    FinanceLedgerModule,
    FinancePlanningModule,
    FinanceSubscriptionsModule,
    FinanceMerchantsModule,
  ],
  controllers: [EntitiesController],
  providers: [FinanceEntityLookupService],
  exports: [FinanceEntityLookupService],
})
export class FinanceEntitiesModule {}
