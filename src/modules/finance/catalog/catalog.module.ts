import { Module } from '@nestjs/common';
import { CatalogService } from './application/catalog.service';
import { CatalogRepository } from './infrastructure/catalog.repository';
import { AccountsController } from './presentation/accounts.controller';
import { CardsController } from './presentation/cards.controller';
import { CategoriesController } from './presentation/categories.controller';
import { InstitutionsController } from './presentation/institutions.controller';

@Module({
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
