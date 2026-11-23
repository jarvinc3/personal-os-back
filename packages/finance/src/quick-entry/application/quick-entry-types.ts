import type { CatalogService } from '../../catalog/application/catalog.service';

export type CatalogAccount = Awaited<
  ReturnType<CatalogService['listAccounts']>
>[number];

export type CatalogCard = Awaited<
  ReturnType<CatalogService['listCards']>
>[number];

export type CatalogCategory = Awaited<
  ReturnType<CatalogService['listCategories']>
>[number];
