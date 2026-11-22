import { Module } from '@nestjs/common';
import { LogosModule } from '@personal-os/logos';
import { FinanceFxModule } from '../fx/fx.module';
import { FinanceLedgerModule } from '../ledger/ledger.module';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { DeletionJournalModule } from '../shared/deletion-journal.module';
import { CatalogService } from './application/catalog.service';
import { CatalogAccountsService } from './application/catalog-accounts.service';
import { CatalogAccountNumbersService } from './application/catalog-account-numbers.service';
import { CatalogCardBalancesService } from './application/catalog-card-balances.service';
import { CatalogCardsService } from './application/catalog-cards.service';
import { CatalogCategoriesService } from './application/catalog-categories.service';
import { CatalogEmailProductsService } from './application/catalog-email-products.service';
import { CatalogInstitutionsService } from './application/catalog-institutions.service';
import { CatalogViews } from './application/catalog-views';
import { EnsureCashInstitutionUseCase } from './application/ensure-cash-institution.use-case';
import { InstrumentHistoryService } from './application/instrument-history.service';
import { CatalogAccountRepository } from './infrastructure/catalog-account.repository';
import { CatalogCardBalanceRepository } from './infrastructure/catalog-card-balance.repository';
import { CatalogCardRepository } from './infrastructure/catalog-card.repository';
import { CatalogCashRepository } from './infrastructure/catalog-cash.repository';
import { CatalogCategoryRepository } from './infrastructure/catalog-category.repository';
import { CatalogInstitutionRepository } from './infrastructure/catalog-institution.repository';
import { CatalogInstrumentHistoryRepository } from './infrastructure/catalog-instrument-history.repository';
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
    CatalogAccountRepository,
    CatalogCardBalanceRepository,
    CatalogCardRepository,
    CatalogCashRepository,
    CatalogCategoryRepository,
    CatalogInstitutionRepository,
    CatalogInstrumentHistoryRepository,
    CatalogViews,
    CatalogAccountNumbersService,
    CatalogAccountsService,
    CatalogInstitutionsService,
    CatalogCardsService,
    CatalogCardBalancesService,
    CatalogEmailProductsService,
    CatalogService,
    CatalogCategoriesService,
    InstrumentHistoryService,
    EnsureCashInstitutionUseCase,
  ],
  exports: [
    CatalogAccountRepository,
    CatalogCardRepository,
    CatalogInstitutionRepository,
    CatalogService,
    CatalogCategoriesService,
    InstrumentHistoryService,
    EnsureCashInstitutionUseCase,
  ],
})
export class FinanceCatalogModule {}
