import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AnalyticsService } from '../../analytics/application/analytics.service';
import { WeeklySummaryService } from '../../analytics/application/weekly-summary.service';
import { AnalyticsController } from '../../analytics/presentation/analytics.controller';
import { CatalogService } from '../../catalog/application/catalog.service';
import { CategoriesController } from '../../catalog/presentation/categories.controller';
import { FinanceEntityLookupService } from '../../entities/application/finance-entity-lookup.service';
import { EntitiesController } from '../../entities/presentation/entities.controller';
import { ChangeBaseCurrencyUseCase } from '../../fx/application/change-base-currency.use-case';
import { GetExchangeRatesUseCase } from '../../fx/application/get-exchange-rates.use-case';
import { ExchangeRateHostAdapter } from '../../fx/infrastructure/exchange-rate-host.adapter';
import { MAX_EXCHANGE_RATE_QUOTES } from '../../fx/presentation/dto/exchange-rates-query.dto';
import { CurrenciesController } from '../../fx/presentation/currencies.controller';
import { MerchantsService } from '../../merchants/application/merchants.service';
import { MerchantsController } from '../../merchants/presentation/merchants.controller';
import { QuickEntryService } from '../../quick-entry/application/quick-entry.service';
import { QuickEntryController } from '../../quick-entry/presentation/quick-entry.controller';
import { ReconciliationsService } from '../../reconciliation/application/reconciliations.service';
import { BankChargesController } from '../../reconciliation/presentation/bank-charges.controller';
import { RecycleBinService } from '../../shared/application/recycle-bin.service';
import { RecycleBinController } from '../../shared/presentation/recycle-bin.controller';

type OperationObject = {
  parameters?: ParameterObject[];
  responses?: Record<
    string,
    {
      content?: Record<string, { schema?: Record<string, unknown> }>;
    }
  >;
};

type ParameterObject = {
  name?: string;
  in?: string;
  schema?: Record<string, unknown>;
};

type OpenApiDocument = {
  paths: Record<string, Record<string, OperationObject>>;
  components?: { schemas?: Record<string, Record<string, unknown>> };
};

const PROVIDERS = [
  CatalogService,
  MerchantsService,
  ExchangeRateHostAdapter,
  GetExchangeRatesUseCase,
  ChangeBaseCurrencyUseCase,
  AnalyticsService,
  WeeklySummaryService,
  FinanceEntityLookupService,
  QuickEntryService,
  ReconciliationsService,
  RecycleBinService,
];

async function buildDocument(): Promise<OpenApiDocument> {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      CategoriesController,
      MerchantsController,
      CurrenciesController,
      AnalyticsController,
      EntitiesController,
      QuickEntryController,
      BankChargesController,
      RecycleBinController,
    ],
    providers: PROVIDERS.map((provider) => ({
      provide: provider,
      useValue: {},
    })),
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  const config = new DocumentBuilder().setTitle('Personal OS API').build();

  return SwaggerModule.createDocument(
    app,
    config,
  ) as unknown as OpenApiDocument;
}

type SuccessSchemaInput = {
  document: OpenApiDocument;
  path: string;
  method: string;
};

function successSchema({
  document,
  path,
  method,
}: SuccessSchemaInput): Record<string, unknown> | undefined {
  const operation = document.paths[path]?.[method];
  const response =
    operation?.responses?.['200'] ?? operation?.responses?.['201'];

  return response?.content?.['application/json']?.schema;
}

function resolveSchema(
  document: OpenApiDocument,
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const reference = schema?.$ref;
  if (typeof reference !== 'string') {
    return schema;
  }
  const name = reference.split('/').at(-1);
  return name ? document.components?.schemas?.[name] : undefined;
}

describe('OpenAPI response schemas of the finance catalog and analytics', () => {
  let document: OpenApiDocument;

  beforeAll(async () => {
    document = await buildDocument();
  });

  it('publishes a schema for every 2xx response of these controllers', () => {
    const operations = [
      ['/api/finance/categories', 'get'],
      ['/api/finance/categories', 'post'],
      ['/api/finance/categories/{id}', 'patch'],
      ['/api/finance/categories/{id}', 'delete'],
      ['/api/finance/categories/{id}/restore', 'post'],
      ['/api/finance/merchants', 'get'],
      ['/api/finance/merchants', 'post'],
      ['/api/finance/merchants/suggest', 'get'],
      ['/api/finance/merchants/{id}', 'get'],
      ['/api/finance/merchants/{id}', 'patch'],
      ['/api/finance/merchants/{id}/duplicates', 'get'],
      ['/api/finance/merchants/{id}/duplicates/{otherId}/dismiss', 'post'],
      ['/api/finance/merchants/{id}/duplicates/{otherId}/dismiss', 'delete'],
      ['/api/finance/merchants/{id}/merge', 'post'],
      ['/api/finance/merchants/{id}/logo', 'post'],
      ['/api/finance/merchants/{id}/logo', 'delete'],
      ['/api/finance/currencies', 'get'],
      ['/api/finance/exchange-rates', 'get'],
      ['/api/finance/base-currency', 'post'],
      ['/api/finance/analytics/weekly-summary', 'get'],
      ['/api/finance/analytics/summary', 'get'],
      ['/api/finance/analytics/spending-by-category', 'get'],
      ['/api/finance/analytics/budget-status', 'get'],
      ['/api/finance/analytics/spending-over-time', 'get'],
      ['/api/finance/entities/lookup', 'post'],
      ['/api/finance/quick-entry/parse', 'post'],
      ['/api/finance/bank-charges', 'get'],
      ['/api/finance/recycle-bin', 'get'],
    ];

    const missing = operations.filter(
      ([path, method]) =>
        successSchema({ document, path, method }) === undefined,
    );

    expect(missing).toEqual([]);
  });

  it('declares the money of the catalog and analytics as decimal text', () => {
    const merchant = document.components?.schemas?.MerchantResponseDto as {
      properties?: Record<string, { type?: string }>;
    };
    const analytics = document.components?.schemas
      ?.AnalyticsSummaryResponseDto as {
      properties?: Record<string, { type?: string }>;
    };
    const spending = document.components?.schemas
      ?.SpendingByCategoryResponseDto as {
      properties?: Record<string, { type?: string }>;
    };
    const weekly = document.components?.schemas?.WeeklySummaryResponseDto as {
      properties?: Record<string, { type?: string }>;
    };
    const bankCharges = document.components?.schemas
      ?.BankChargesResponseDto as {
      properties?: Record<string, { type?: string }>;
    };
    const quickEntry = document.components?.schemas
      ?.QuickEntryDraftResponseDto as {
      properties?: Record<string, { type?: string }>;
    };

    expect(merchant.properties?.monthSpend).toMatchObject({ type: 'string' });
    expect(analytics.properties?.cashFlow).toMatchObject({ type: 'string' });
    expect(spending.properties?.total).toMatchObject({ type: 'string' });
    expect(weekly.properties?.expenses).toMatchObject({ type: 'string' });
    expect(bankCharges.properties?.total).toMatchObject({ type: 'string' });
    expect(quickEntry.properties?.amount).toMatchObject({ type: 'string' });
  });

  it('declares the cursor fields of the paginated endpoints', () => {
    for (const [path, method] of [
      ['/api/finance/merchants', 'get'],
      ['/api/finance/recycle-bin', 'get'],
    ]) {
      const schema = resolveSchema(
        document,
        successSchema({ document, path, method }),
      ) as {
        properties?: Record<string, unknown>;
      };
      expect(schema.properties).toHaveProperty('nextCursor');
      expect(schema.properties).toHaveProperty('hasMore');
      expect(schema.properties?.items).toMatchObject({ type: 'array' });
    }
  });

  it('publishes the entity lookup as the union of the entity responses', () => {
    const schema = successSchema({
      document,
      path: '/api/finance/entities/lookup',
      method: 'post',
    }) as {
      type?: string;
      items?: { oneOf?: unknown[]; nullable?: boolean };
    };

    expect(schema.type).toBe('array');
    expect(schema.items?.oneOf).toHaveLength(10);
    expect(schema.items?.nullable).toBe(true);
  });

  it('publishes the quotes limit of the exchange rates', () => {
    const quotes = document.paths[
      '/api/finance/exchange-rates'
    ]?.get?.parameters?.find((parameter) => parameter.name === 'quotes');

    expect(quotes?.schema).toMatchObject({
      type: 'array',
      maxItems: MAX_EXCHANGE_RATE_QUOTES,
    });
  });

  it('publishes the recycle-bin types and the category response', () => {
    const recycle = document.components?.schemas?.RecycleBinResponseDto as {
      properties?: Record<string, unknown>;
    };

    expect(recycle.properties).toHaveProperty('archived');
    expect(recycle.properties).toHaveProperty('items');
    expect(document.components?.schemas?.CategoryResponseDto).toBeDefined();
  });
});
