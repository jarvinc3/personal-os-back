import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { PlanningService } from '../../planning/application/planning.service';
import { AllocateToGoalUseCase } from '../../planning/application/allocate-to-goal.use-case';
import { ApplyReceivableCreditUseCase } from '../../planning/application/apply-receivable-credit.use-case';
import { LinkTransactionUseCase } from '../../planning/application/link-transaction.use-case';
import { RecordReceivablePaymentUseCase } from '../../planning/application/record-receivable-payment.use-case';
import { RemoveSavingsGoalContributionUseCase } from '../../planning/application/remove-savings-goal-contribution.use-case';
import { UnlinkTransactionUseCase } from '../../planning/application/unlink-transaction.use-case';
import { WriteOffReceivableUseCase } from '../../planning/application/write-off-receivable.use-case';
import { BudgetsController } from '../../planning/presentation/budgets.controller';
import { ReceivablesController } from '../../planning/presentation/receivables.controller';
import { SavingsGoalsController } from '../../planning/presentation/savings-goals.controller';
import { TransactionLinksController } from '../../planning/presentation/transaction-links.controller';
import { RecurringService } from '../../recurring/application/recurring.service';
import { RecurringController } from '../../recurring/presentation/recurring.controller';
import { SubscriptionsService } from '../../subscriptions/application/subscriptions.service';
import { SubscriptionsController } from '../../subscriptions/presentation/subscriptions.controller';

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
  components?: { schemas?: Record<string, Record<string, unknown>> };
};

const PROVIDERS = [
  PlanningService,
  AllocateToGoalUseCase,
  RemoveSavingsGoalContributionUseCase,
  RecordReceivablePaymentUseCase,
  ApplyReceivableCreditUseCase,
  WriteOffReceivableUseCase,
  LinkTransactionUseCase,
  UnlinkTransactionUseCase,
  SubscriptionsService,
  RecurringService,
];

async function buildDocument(): Promise<OpenApiDocument> {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      BudgetsController,
      SavingsGoalsController,
      ReceivablesController,
      TransactionLinksController,
      SubscriptionsController,
      RecurringController,
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

function schemaProperties(
  document: OpenApiDocument,
  name: string,
): Record<string, { type?: string }> | undefined {
  const schema = document.components?.schemas?.[name] as
    { properties?: Record<string, { type?: string }> } | undefined;
  return schema?.properties;
}

function expectDecimalText(
  document: OpenApiDocument,
  name: string,
  fields: readonly string[],
): void {
  for (const field of fields) {
    expect(schemaProperties(document, name)?.[field]).toMatchObject({
      type: 'string',
    });
  }
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

describe('OpenAPI response schemas of the finance planning', () => {
  let document: OpenApiDocument;

  beforeAll(async () => {
    document = await buildDocument();
  });

  it('publishes a schema for every 2xx response of these controllers', () => {
    const operations = [
      ['/api/finance/budgets', 'get'],
      ['/api/finance/budgets', 'post'],
      ['/api/finance/budgets/{id}', 'get'],
      ['/api/finance/budgets/{id}', 'patch'],
      ['/api/finance/budgets/{id}', 'delete'],
      ['/api/finance/budgets/{id}/transactions', 'get'],
      ['/api/finance/budgets/{id}/restore', 'post'],
      ['/api/finance/savings-goals', 'get'],
      ['/api/finance/savings-goals', 'post'],
      ['/api/finance/savings-goals/{id}', 'get'],
      ['/api/finance/savings-goals/{id}', 'patch'],
      ['/api/finance/savings-goals/{id}', 'delete'],
      ['/api/finance/savings-goals/{id}/restore', 'post'],
      ['/api/finance/savings-goals/{id}/allocations', 'get'],
      ['/api/finance/savings-goals/{id}/allocations', 'post'],
      ['/api/finance/savings-goals/{id}/allocations/{allocationId}', 'delete'],
      ['/api/finance/savings-goals/{id}/contributions', 'get'],
      ['/api/finance/savings-goals/{id}/contributions', 'post'],
      [
        '/api/finance/savings-goals/{id}/contributions/{allocationId}',
        'delete',
      ],
      ['/api/finance/receivables', 'get'],
      ['/api/finance/receivables', 'post'],
      ['/api/finance/receivables/{id}', 'get'],
      ['/api/finance/receivables/{id}', 'patch'],
      ['/api/finance/receivables/{id}', 'delete'],
      ['/api/finance/receivables/{id}/restore', 'post'],
      ['/api/finance/receivables/{id}/payments', 'get'],
      ['/api/finance/receivables/{id}/payments', 'post'],
      ['/api/finance/receivables/{id}/credit', 'post'],
      ['/api/finance/receivables/{id}/write-off', 'post'],
      ['/api/finance/transactions/{id}/link', 'post'],
      ['/api/finance/transactions/{id}/link', 'delete'],
      ['/api/finance/subscriptions', 'get'],
      ['/api/finance/subscriptions', 'post'],
      ['/api/finance/subscriptions/summary', 'get'],
      ['/api/finance/subscriptions/breakdown', 'get'],
      ['/api/finance/subscriptions/upcoming', 'get'],
      ['/api/finance/subscriptions/alerts', 'get'],
      ['/api/finance/subscriptions/alerts/dismiss-all', 'post'],
      ['/api/finance/subscriptions/alerts/dismiss', 'post'],
      ['/api/finance/subscriptions/{id}', 'get'],
      ['/api/finance/subscriptions/{id}', 'patch'],
      ['/api/finance/subscriptions/{id}/pause', 'post'],
      ['/api/finance/subscriptions/{id}/resume', 'post'],
      ['/api/finance/subscriptions/{id}/cancel', 'post'],
      ['/api/finance/subscriptions/{id}/payments', 'get'],
      ['/api/finance/subscriptions/{id}/payments', 'post'],
      ['/api/finance/subscriptions/{id}/logo', 'post'],
      ['/api/finance/recurring', 'get'],
      ['/api/finance/recurring', 'post'],
      ['/api/finance/recurring/upcoming', 'get'],
      ['/api/finance/recurring/{id}', 'patch'],
    ];

    const missing = operations.filter(
      ([path, method]) =>
        successSchema({ document, path, method }) === undefined,
    );

    expect(missing).toEqual([]);
  });

  it('declares the money of the planning responses as decimal text', () => {
    expectDecimalText(document, 'BudgetResponseDto', [
      'amountLimit',
      'amountSpent',
      'carriedOver',
      'effectiveLimit',
    ]);
    expectDecimalText(document, 'SavingsGoalResponseDto', [
      'targetAmount',
      'currentAmount',
    ]);
    expectDecimalText(document, 'ReceivableResponseDto', [
      'amount',
      'paidAmount',
      'creditBalance',
      'writtenOffAmount',
    ]);
    expectDecimalText(document, 'SubscriptionResponseDto', [
      'amount',
      'monthlyEquivalent',
      'annualEquivalent',
    ]);
    expectDecimalText(document, 'RecurringPatternResponseDto', [
      'avgAmount',
      'monthlyEquivalent',
      'annualEquivalent',
    ]);
  });

  it('declares the cursor fields of every paginated endpoint', () => {
    for (const [path, method] of [
      ['/api/finance/budgets', 'get'],
      ['/api/finance/savings-goals', 'get'],
      ['/api/finance/savings-goals/{id}/allocations', 'get'],
      ['/api/finance/receivables', 'get'],
      ['/api/finance/receivables/{id}/payments', 'get'],
      ['/api/finance/subscriptions', 'get'],
      ['/api/finance/subscriptions/{id}/payments', 'get'],
      ['/api/finance/recurring', 'get'],
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

  it('publishes the budget category and the link descriptor', () => {
    const budget = document.components?.schemas?.BudgetResponseDto as {
      properties?: Record<string, unknown>;
    };

    expect(budget.properties).toHaveProperty('category');
    expect(budget.properties).toHaveProperty('categories');
    expect(budget.properties).toHaveProperty('effectiveLimit');
    expect(document.components?.schemas?.PlanningLinkResponseDto).toBeDefined();
  });

  it('publishes the subscription alert and payment shapes', () => {
    const alert = document.components?.schemas
      ?.SubscriptionAlertResponseDto as {
      properties?: Record<string, unknown>;
    };
    const payment = document.components?.schemas
      ?.SubscriptionPaymentResponseDto as {
      properties?: Record<string, unknown>;
    };

    expect(alert.properties).toHaveProperty('kind');
    expect(alert.properties).toHaveProperty('expectedAmount');
    expect(payment.properties).toHaveProperty('transaction');
    expect(
      document.components?.schemas?.SubscriptionSummaryResponseDto,
    ).toBeDefined();
  });
});
