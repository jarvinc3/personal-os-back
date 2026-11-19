import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AiConsentService } from './consent/ai-consent.service';
import { AiConsentController } from './consent/ai-consent.controller';
import { AiEmailSourceService } from './email/ai-email-source.service';
import { GmailSyncService } from './email/gmail-sync.service';
import { EmailSampleImportService } from './email/email-sample-import.service';
import { EmailProductProposalsService } from './email/email-product-proposals.service';
import { EmailProductProposalsController } from './email/email-product-proposals.controller';
import { AiIntelligenceController } from './email/ai-intelligence.controller';
import { AiEvidenceService } from './evidence/ai-evidence.service';
import { AiEvidenceController } from './evidence/ai-evidence.controller';
import { AiRolesService } from './roles/ai-roles.service';
import { AiRolesController } from './roles/ai-roles.controller';
import { AiSignalsController } from './signals/ai-signals.controller';
import { AiSignalsService } from './signals/ai-signals.service';
import { AI_EMAIL_MESSAGE_STATUS_FILTERS } from './email/ai-email-message-status';

type OperationObject = {
  responses?: Record<
    string,
    { content?: Record<string, { schema?: Record<string, unknown> }> }
  >;
};

type OpenApiDocument = {
  paths: Record<string, Record<string, OperationObject>>;
  components?: { schemas?: Record<string, Record<string, unknown>> };
};

async function buildDocument(): Promise<OpenApiDocument> {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      AiConsentController,
      AiIntelligenceController,
      EmailProductProposalsController,
      AiEvidenceController,
      AiRolesController,
      AiSignalsController,
    ],
    providers: [
      { provide: AiConsentService, useValue: {} },
      { provide: AiEmailSourceService, useValue: {} },
      { provide: GmailSyncService, useValue: {} },
      { provide: EmailSampleImportService, useValue: {} },
      { provide: EmailProductProposalsService, useValue: {} },
      { provide: AiEvidenceService, useValue: {} },
      { provide: AiRolesService, useValue: {} },
      { provide: AiSignalsService, useValue: {} },
      { provide: ConfigService, useValue: {} },
    ],
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
  for (const status of ['200', '201', '202']) {
    const schema =
      operation?.responses?.[status]?.content?.['application/json']?.schema;
    if (schema) {
      return schema;
    }
  }
  return undefined;
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

describe('OpenAPI response schemas of intelligence', () => {
  let document: OpenApiDocument;

  beforeAll(async () => {
    document = await buildDocument();
  });

  it('publishes a schema for every 2xx response of these controllers', () => {
    const operations = [
      ['/api/intelligence/preferences/consent', 'get'],
      ['/api/intelligence/preferences/consent', 'patch'],
      ['/api/intelligence', 'get'],
      ['/api/intelligence/signals', 'get'],
      ['/api/intelligence/signals/{signalId}', 'get'],
      ['/api/intelligence/messages', 'get'],
      ['/api/intelligence/messages/{messageId}', 'get'],
      ['/api/intelligence/email/connect', 'post'],
      ['/api/intelligence/email/sync', 'post'],
      ['/api/intelligence/email/sample-import', 'post'],
      ['/api/intelligence/email/product-proposals/discover', 'post'],
      ['/api/intelligence/email/product-proposals', 'get'],
      ['/api/intelligence/email/product-proposals/{proposalId}', 'patch'],
      [
        '/api/intelligence/email/product-proposals/{proposalId}/approve',
        'post',
      ],
      [
        '/api/intelligence/email/product-proposals/{proposalId}/discard',
        'post',
      ],
      ['/api/intelligence/email/reset', 'post'],
      ['/api/intelligence/email/oauth/diagnostics', 'get'],
      ['/api/intelligence/dataset', 'get'],
      ['/api/intelligence/review-queue', 'get'],
      ['/api/intelligence/review-groups', 'get'],
      ['/api/intelligence/review-groups/verifications', 'post'],
      ['/api/intelligence/messages/{messageId}/verifications', 'post'],
      ['/api/intelligence/runs', 'get'],
      ['/api/intelligence/admin/roles', 'get'],
      ['/api/intelligence/admin/roles/{userId}', 'patch'],
    ];

    const missing = operations.filter(
      ([path, method]) =>
        successSchema({ document, path, method }) === undefined,
    );

    expect(missing).toEqual([]);
  });

  it('publishes the accepted status of the sample import', () => {
    const operation = document.paths['/api/intelligence/email/sample-import']
      ?.post as OperationObject | undefined;
    const status = document.paths[
      '/api/intelligence/email/sample-import/{jobId}'
    ]?.get as OperationObject | undefined;

    expect(
      operation?.responses?.['202']?.content?.['application/json']?.schema,
    ).toBeDefined();
    expect(operation?.responses?.['200']).toBeUndefined();
    expect(
      status?.responses?.['200']?.content?.['application/json']?.schema,
    ).toBeDefined();
  });

  it('documents the two targets of a card payment preview', () => {
    const prediction = document.components?.schemas
      ?.AiEmailSamplePredictionDto as {
      properties?: Record<string, unknown>;
    };

    expect(prediction.properties?.cardPayment).toMatchObject({
      $ref: '#/components/schemas/AiEmailSampleCardPaymentDto',
    });
  });

  it('documents per-email inference provenance and all review reasons', () => {
    const item = document.components?.schemas?.AiEmailSampleItemDto as {
      properties?: Record<string, Record<string, unknown>>;
    };
    const prediction = document.components?.schemas
      ?.AiEmailSamplePredictionDto as {
      properties?: Record<string, Record<string, unknown>>;
    };

    expect(item.properties?.provider).toMatchObject({
      type: 'string',
      nullable: true,
    });
    expect(item.properties?.model).toMatchObject({
      type: 'string',
      nullable: true,
    });
    expect(prediction.properties?.reviewReasons).toMatchObject({
      type: 'array',
      items: { type: 'string' },
    });
  });

  it('declares the cursor fields of the intelligence lists', () => {
    for (const [path, method] of [
      ['/api/intelligence/messages', 'get'],
      ['/api/intelligence/review-queue', 'get'],
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

  it('declares the search and status filters of the messages list', () => {
    const operation = document.paths['/api/intelligence/messages']?.get as
      | {
          parameters?: Array<{
            name: string;
            schema?: { enum?: unknown[] };
          }>;
        }
      | undefined;
    const parameters = operation?.parameters ?? [];

    expect(parameters.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['q', 'status', 'cursor']),
    );
    expect(
      parameters.find(({ name }) => name === 'status')?.schema?.enum,
    ).toEqual([...AI_EMAIL_MESSAGE_STATUS_FILTERS]);
  });

  it('limits a verification selection to 20 message ids in OpenAPI', () => {
    const schema = document.components?.schemas?.[
      'CreateReviewSelectionVerificationDto'
    ] as { properties?: { messageIds?: { maxItems?: number } } } | undefined;

    expect(schema?.properties?.messageIds?.maxItems).toBe(20);
  });

  it('publishes the dashboard, runs and roles shapes', () => {
    const dashboard = document.components?.schemas
      ?.AiEmailDashboardResponseDto as {
      properties?: Record<string, unknown>;
    };
    const run = document.components?.schemas?.AiAnalysisRunResponseDto as {
      properties?: Record<string, unknown>;
    };

    expect(dashboard.properties).toHaveProperty('connection');
    expect(dashboard.properties).toHaveProperty('counters');
    expect(run.properties).toHaveProperty('observationSequence');
    expect(document.components?.schemas?.AiRoleUserResponseDto).toBeDefined();
    expect(
      document.components?.schemas?.AiReviewQueueResponseDto,
    ).toBeDefined();
  });

  it('publishes route-level classification details for email messages', () => {
    const message = document.components?.schemas?.AiEmailMessageResponseDto as {
      properties?: Record<string, unknown>;
    };

    expect(message.properties).toHaveProperty('classification');
    expect(message.properties).toHaveProperty('classificationPath');
    expect(message.properties).toHaveProperty('classificationProvider');
    expect(message.properties).toHaveProperty('classificationModel');
    expect(message.properties?.classifications).toMatchObject({
      type: 'array',
    });
    expect(
      document.components?.schemas?.AiEmailClassificationResponseDto,
    ).toBeDefined();
  });
});
