import { Module } from '@nestjs/common';
import { LogosModule } from '@personal-os/logos';
import { FinanceFxModule } from '../fx/fx.module';
import { FinanceLedgerModule } from '../ledger/ledger.module';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { DeletionJournalModule } from '../shared/deletion-journal.module';
import { CatalogService } from './application/catalog.service';
import { EnsureCashInstitutionUseCase } from './application/ensure-cash-institution.use-case';
import { InstrumentHistoryService } from './application/instrument-history.service';
import { CatalogRepository } from './infrastructure/catalog.repository';
import { AccountsController } from './presentation/accounts.controller';
import { CardsController } from './presentation/cards.controller';
import { CategoriesController } from './presentation/categories.controller';
import { InstitutionsController } from './presentation/institutions.controller';

@Module({
  imports: [
    FinanceOwnershipModule,
    FinanceLedgerModule,
    FinanceFxModule,
    LogosModule,
    DeletionJournalModule,
  ],
  controllers: [
    AccountsController,
    InstitutionsController,
    CardsController,
    CategoriesController,
  ],
  providers: [
    CatalogRepository,
    CatalogService,
    InstrumentHistoryService,
    EnsureCashInstitutionUseCase,
  ],
  exports: [
    CatalogService,
    CatalogRepository,
    InstrumentHistoryService,
    EnsureCashInstitutionUseCase,
  ],
})
export class FinanceCatalogModule {}
