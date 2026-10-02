import { Module } from '@nestjs/common';
import { LogosModule } from '@personal-os/logos';
import { FinanceLedgerModule } from '../ledger/ledger.module';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { CatalogService } from './application/catalog.service';
import { CatalogRepository } from './infrastructure/catalog.repository';
import { AccountsController } from './presentation/accounts.controller';
import { CardsController } from './presentation/cards.controller';
import { CategoriesController } from './presentation/categories.controller';
import { InstitutionsController } from './presentation/institutions.controller';

@Module({
  imports: [FinanceOwnershipModule, FinanceLedgerModule, LogosModule],
  controllers: [
    AccountsController,
    InstitutionsController,
    CardsController,
    CategoriesController,
  ],
  providers: [CatalogRepository, CatalogService],
  exports: [CatalogService, CatalogRepository],
})
export class FinanceCatalogModule {}
