import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { CatalogService } from '../../catalog/application/catalog.service';
import { InstrumentHistoryService } from '../../catalog/application/instrument-history.service';
import { AccountsController } from '../../catalog/presentation/accounts.controller';
import { CardsController } from '../../catalog/presentation/cards.controller';
import { InstitutionsController } from '../../catalog/presentation/institutions.controller';
import { ApplyLoanPrepaymentUseCase } from '../../planning/application/apply-loan-prepayment.use-case';
import { PayNextLoanInstallmentUseCase } from '../../planning/application/pay-next-loan-installment.use-case';
import { PlanningService } from '../../planning/application/planning.service';
import { LoansController } from '../../planning/presentation/loans.controller';
import { CardStatementsService } from '../../statements/application/card-statements.service';
import { StatementImportsService } from '../../statements/application/statement-imports.service';
import { CardStatementsController } from '../../statements/presentation/card-statements.controller';
import { StatementImportsController } from '../../statements/presentation/statement-imports.controller';

type OperationObject = {
  responses?: Record<
    string,
    {
      content?: Record<string, { schema?: Record<string, unknown> }>;
    }
  >;
};

type OpenApiDocument = {
  paths: Record<string, Record<string, OperationObject>>;
  components?: { schemas?: Record<string, unknown> };
};

const PROVIDERS = [
  CatalogService,
  InstrumentHistoryService,
  PlanningService,
  PayNextLoanInstallmentUseCase,
  ApplyLoanPrepaymentUseCase,
  CardStatementsService,
  StatementImportsService,
];

async function buildDocument(): Promise<OpenApiDocument> {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      AccountsController,
      CardsController,
      InstitutionsController,
      LoansController,
      CardStatementsController,
      StatementImportsController,
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

function successSchema(
  document: OpenApiDocument,
  path: string,
  method: string,
): Record<string, unknown> | undefined {
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
  return name
    ? (document.components?.schemas?.[name] as Record<string, unknown>)
    : undefined;
}

describe('OpenAPI response schemas of the finance products', () => {
  let document: OpenApiDocument;

  beforeAll(async () => {
    document = await buildDocument();
  });

  it('publishes a schema for every 2xx response of these controllers', () => {
    const operations = [
      ['/api/finance/accounts', 'get'],
      ['/api/finance/accounts', 'post'],
      ['/api/finance/accounts/{id}', 'get'],
      ['/api/finance/accounts/{id}', 'patch'],
      ['/api/finance/accounts/{id}', 'delete'],
      ['/api/finance/accounts/{id}/history', 'get'],
      ['/api/finance/accounts/{id}/restore', 'post'],
      ['/api/finance/accounts/{id}/statements/import', 'post'],
      ['/api/finance/cards', 'get'],
      ['/api/finance/cards', 'post'],
      ['/api/finance/cards/{id}', 'get'],
      ['/api/finance/cards/{id}', 'patch'],
      ['/api/finance/cards/{id}', 'delete'],
      ['/api/finance/cards/{id}/history', 'get'],
      ['/api/finance/cards/{id}/restore', 'post'],
      ['/api/finance/cards/{id}/balances', 'post'],
      ['/api/finance/cards/{id}/balances/{currency}', 'delete'],
      ['/api/finance/cards/{id}/balances/credit-limit', 'post'],
      ['/api/finance/cards/{id}/statements', 'get'],
      ['/api/finance/cards/{id}/statements/{statementId}', 'get'],
      ['/api/finance/cards/{id}/statements/{statementId}', 'patch'],
      ['/api/finance/cards/{id}/statements/import', 'post'],
      ['/api/finance/institutions', 'get'],
      ['/api/finance/institutions', 'post'],
      ['/api/finance/institutions/{id}', 'patch'],
      ['/api/finance/institutions/{id}', 'delete'],
      ['/api/finance/institutions/{id}/restore', 'post'],
      ['/api/finance/institutions/{id}/logo', 'post'],
      ['/api/finance/loans', 'get'],
      ['/api/finance/loans', 'post'],
      ['/api/finance/loans/{id}', 'get'],
      ['/api/finance/loans/{id}', 'patch'],
      ['/api/finance/loans/{id}', 'delete'],
      ['/api/finance/loans/{id}/restore', 'post'],
      ['/api/finance/loans/{id}/installments', 'get'],
      ['/api/finance/loans/{id}/schedule', 'get'],
      ['/api/finance/loans/{id}/pay-next-installment', 'post'],
      ['/api/finance/loans/{id}/prepayments', 'post'],
      ['/api/finance/loans/{id}/prepayments/preview', 'get'],
      ['/api/finance/statement-imports/{id}', 'get'],
      ['/api/finance/statement-imports/{id}', 'delete'],
      ['/api/finance/statement-imports/{id}/apply', 'post'],
      ['/api/finance/statement-imports/{id}/lines/{lineId}', 'patch'],
    ];

    const missing = operations.filter(
      ([path, method]) => successSchema(document, path, method) === undefined,
    );

    expect(missing).toEqual([]);
  });

  it('declares the money of an account as decimal text', () => {
    const schema = document.components?.schemas?.AccountResponseDto as {
      properties?: Record<string, { type?: string; example?: string }>;
    };

    expect(schema.properties?.balance).toMatchObject({
      type: 'string',
      example: '1500.00',
    });
  });

  it('declares the cursor fields of the paginated products', () => {
    for (const path of [
      '/api/finance/accounts',
      '/api/finance/cards',
      '/api/finance/institutions',
      '/api/finance/loans',
    ]) {
      const schema = resolveSchema(
        document,
        successSchema(document, path, 'get'),
      ) as {
        properties?: Record<string, unknown>;
      };
      expect(schema.properties).toHaveProperty('nextCursor');
      expect(schema.properties).toHaveProperty('hasMore');
      expect(schema.properties?.items).toMatchObject({ type: 'array' });
    }
  });
});
