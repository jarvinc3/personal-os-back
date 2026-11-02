import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';

type OpenApiDocument = {
  paths: Record<
    string,
    Record<
      string,
      {
        responses?: Record<
          string,
          { content?: Record<string, { schema?: Record<string, unknown> }> }
        >;
      }
    >
  >;
  components?: { schemas?: Record<string, unknown> };
};

describe('OpenAPI response schemas of the auth session', () => {
  let document: OpenApiDocument;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: EventEmitter2, useValue: {} },
        { provide: CACHE_MANAGER, useValue: {} },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    const config = new DocumentBuilder().setTitle('Personal OS API').build();

    document = SwaggerModule.createDocument(
      app,
      config,
    ) as unknown as OpenApiDocument;
  });

  it('publishes the session schema', () => {
    const schema =
      document.paths['/api/auth/session']?.get?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema;

    expect(schema).toBeDefined();
    expect(document.components?.schemas?.AuthSessionResponseDto).toBeDefined();
  });
});
