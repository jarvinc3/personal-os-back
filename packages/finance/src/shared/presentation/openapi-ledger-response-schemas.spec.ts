import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { BalanceIntegrityService } from '../../integrity/application/balance-integrity.service';
import { IntegrityController } from '../../integrity/presentation/integrity.controller';
import { AdjustBalanceUseCase } from '../../ledger/application/adjust-balance.use-case';
import { ConfirmTransactionUseCase } from '../../ledger/application/confirm-transaction.use-case';
import { ConfirmTransferUseCase } from '../../ledger/application/confirm-transfer.use-case';
import { CreateCardPaymentUseCase } from '../../ledger/application/create-card-payment.use-case';
import { CreateTransactionUseCase } from '../../ledger/application/create-transaction.use-case';
import { CreateTransferUseCase } from '../../ledger/application/create-transfer.use-case';
import { DeleteTransactionUseCase } from '../../ledger/application/delete-transaction.use-case';
import { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import { MarkNotDuplicateUseCase } from '../../ledger/application/mark-not-duplicate.use-case';
import { MergeTransactionUseCase } from '../../ledger/application/merge-transaction.use-case';
import { RestoreTransactionUseCase } from '../../ledger/application/restore-transaction.use-case';
import { ReverseTransactionUseCase } from '../../ledger/application/reverse-transaction.use-case';
import { ReverseTransferUseCase } from '../../ledger/application/reverse-transfer.use-case';
import { UnconfirmTransactionUseCase } from '../../ledger/application/unconfirm-transaction.use-case';
import { UnconfirmTransferUseCase } from '../../ledger/application/unconfirm-transfer.use-case';
import { UpdateCardPaymentUseCase } from '../../ledger/application/update-card-payment.use-case';
import { UpdateTransactionUseCase } from '../../ledger/application/update-transaction.use-case';
import { UpdateTransferUseCase } from '../../ledger/application/update-transfer.use-case';
import { CardPaymentsController } from '../../ledger/presentation/card-payments.controller';
import { TransactionsController } from '../../ledger/presentation/transactions.controller';
import { TransfersController } from '../../ledger/presentation/transfers.controller';
import { ReconciliationsService } from '../../reconciliation/application/reconciliations.service';
import { ReconciliationsController } from '../../reconciliation/presentation/reconciliations.controller';

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
  LedgerQueryService,
  CreateTransactionUseCase,
  AdjustBalanceUseCase,
  UpdateTransactionUseCase,
  ConfirmTransactionUseCase,
  ConfirmTransferUseCase,
  UnconfirmTransactionUseCase,
  DeleteTransactionUseCase,
  RestoreTransactionUseCase,
  ReverseTransactionUseCase,
  MergeTransactionUseCase,
  MarkNotDuplicateUseCase,
  CreateTransferUseCase,
  UpdateTransferUseCase,
  UnconfirmTransferUseCase,
  ReverseTransferUseCase,
  CreateCardPaymentUseCase,
  UpdateCardPaymentUseCase,
  ReconciliationsService,
  BalanceIntegrityService,
];

async function buildDocument(): Promise<OpenApiDocument> {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      TransactionsController,
      TransfersController,
      CardPaymentsController,
      ReconciliationsController,
      IntegrityController,
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
  return name ? document.components?.schemas?.[name] : undefined;
}

describe('OpenAPI response schemas of the ledger and reconciliations', () => {
  let document: OpenApiDocument;

  beforeAll(async () => {
    document = await buildDocument();
  });

  it('publishes a schema for every 2xx response of these controllers', () => {
    const operations = [
      ['/api/finance/transactions', 'get'],
      ['/api/finance/balance-adjustments', 'post'],
      ['/api/finance/transactions', 'post'],
      ['/api/finance/transactions/{id}', 'get'],
      ['/api/finance/transactions/{id}', 'patch'],
      ['/api/finance/transactions/{id}', 'delete'],
      ['/api/finance/transactions/{id}/restore', 'post'],
      ['/api/finance/transactions/{id}/confirm', 'post'],
      ['/api/finance/transactions/{id}/unconfirm', 'post'],
      ['/api/finance/transactions/{id}/reverse', 'post'],
      ['/api/finance/transactions/{id}/merge', 'post'],
      ['/api/finance/transactions/{id}/not-duplicate', 'post'],
      ['/api/finance/transfers', 'post'],
      ['/api/finance/transfers/{id}', 'patch'],
      ['/api/finance/transfers/{id}/unconfirm', 'post'],
      ['/api/finance/transfers/{id}/confirm', 'post'],
      ['/api/finance/transfers/{id}/reverse', 'post'],
      ['/api/finance/transfers/{id}', 'delete'],
      ['/api/finance/card-payments', 'post'],
      ['/api/finance/card-payments/{id}', 'patch'],
      ['/api/finance/card-payments/{id}/unconfirm', 'post'],
      ['/api/finance/card-payments/{id}/confirm', 'post'],
      ['/api/finance/card-payments/{id}', 'delete'],
      ['/api/finance/reconciliations/preview', 'post'],
      ['/api/finance/reconciliations', 'post'],
      ['/api/finance/reconciliations/status', 'get'],
      ['/api/finance/reconciliations', 'get'],
      ['/api/finance/reconciliations/{id}', 'get'],
      ['/api/finance/reconciliations/{id}', 'delete'],
      ['/api/finance/reconciliations/{id}/restore', 'post'],
      ['/api/finance/integrity/check', 'get'],
      ['/api/finance/integrity/recalculate', 'post'],
    ];

    const missing = operations.filter(
      ([path, method]) => successSchema(document, path, method) === undefined,
    );

    expect(missing).toEqual([]);
  });

  it('declares the money of a transaction as decimal text', () => {
    const schema = document.components?.schemas?.TransactionResponseDto as {
      properties?: Record<string, { type?: string; example?: string }>;
    };

    for (const field of [
      'amount',
      'ledgerAmount',
      'amountBaseCurrency',
      'exchangeRate',
      'transferToAmount',
    ]) {
      expect(schema.properties?.[field]).toMatchObject({ type: 'string' });
    }
  });

  it('declares the money of reconciliations and integrity as decimal text', () => {
    const reconciliation = document.components?.schemas
      ?.ReconciliationResponseDto as {
      properties?: Record<string, { type?: string }>;
    };
    const integrity = document.components?.schemas?.BalanceDriftResponseDto as {
      properties?: Record<string, { type?: string }>;
    };

    for (const field of ['appBalance', 'realBalance', 'difference']) {
      expect(reconciliation.properties?.[field]).toMatchObject({
        type: 'string',
      });
    }
    for (const field of ['storedBalance', 'expectedBalance', 'difference']) {
      expect(integrity.properties?.[field]).toMatchObject({
        type: 'string',
      });
    }
  });

  it('declares the cursor fields of the paginated endpoints', () => {
    for (const [path, method] of [
      ['/api/finance/transactions', 'get'],
      ['/api/finance/reconciliations', 'get'],
    ]) {
      const schema = resolveSchema(
        document,
        successSchema(document, path, method),
      ) as {
        properties?: Record<string, unknown>;
      };
      expect(schema.properties).toHaveProperty('nextCursor');
      expect(schema.properties).toHaveProperty('hasMore');
      expect(schema.properties?.items).toMatchObject({ type: 'array' });
    }
  });

  it('publishes the transfer operation as a variant of the transaction', () => {
    const page = document.components?.schemas?.TransactionPageResponseDto as {
      properties?: {
        items?: { items?: { oneOf?: unknown[] } };
      };
    };

    expect(page.properties?.items?.items?.oneOf).toHaveLength(2);
    expect(
      document.components?.schemas?.TransactionOperationResponseDto,
    ).toBeDefined();
    expect(document.components?.schemas?.TransferResponseDto).toBeDefined();
    expect(document.components?.schemas?.DeleteResponseDto).toBeDefined();
  });
});
