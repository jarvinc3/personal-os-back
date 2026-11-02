import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { NotificationsService } from '../application/notifications.service';
import { PushTokensService } from '../application/push-tokens.service';
import { NotificationsController } from './notifications.controller';

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
    controllers: [NotificationsController],
    providers: [
      { provide: NotificationsService, useValue: {} },
      { provide: PushTokensService, useValue: {} },
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

function successSchema(
  document: OpenApiDocument,
  path: string,
  method: string,
): Record<string, unknown> | undefined {
  const operation = document.paths[path]?.[method];
  return (
    operation?.responses?.['200']?.content?.['application/json']?.schema ??
    operation?.responses?.['201']?.content?.['application/json']?.schema
  );
}

describe('OpenAPI response schemas of notifications', () => {
  let document: OpenApiDocument;

  beforeAll(async () => {
    document = await buildDocument();
  });

  it('publishes a schema for every 2xx response', () => {
    const operations = [
      ['/api/notifications', 'get'],
      ['/api/notifications', 'post'],
      ['/api/notifications/unread-count', 'get'],
      ['/api/notifications/read-all', 'patch'],
      ['/api/notifications/{id}/read', 'patch'],
      ['/api/notifications/push-tokens', 'post'],
      ['/api/notifications/push-tokens/{token}', 'delete'],
      ['/api/notifications/push-tokens/{token}/deactivate', 'patch'],
    ];

    const missing = operations.filter(
      ([path, method]) => successSchema(document, path, method) === undefined,
    );

    expect(missing).toEqual([]);
  });

  it('declares the cursor fields of the notification list', () => {
    const schema = document.paths['/api/notifications']?.get?.responses?.['200']
      ?.content?.['application/json']?.schema as {
      $ref?: string;
    };
    const name = schema?.$ref?.split('/').at(-1);
    const resolved = name
      ? (document.components?.schemas?.[name] as {
          properties?: Record<string, unknown>;
        })
      : undefined;

    expect(resolved?.properties).toHaveProperty('nextCursor');
    expect(resolved?.properties).toHaveProperty('hasMore');
    expect(document.components?.schemas?.PushTokenResponseDto).toBeDefined();
  });
});
