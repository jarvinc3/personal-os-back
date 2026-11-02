import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { PublicReceivableSharesService } from '../application/public-receivable-shares.service';
import { PublicReceivableSharesController } from './public-receivable-shares.controller';

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
  components?: { schemas?: Record<string, Record<string, unknown>> };
};

describe('OpenAPI response schemas of the public receivable shares', () => {
  let document: OpenApiDocument;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicReceivableSharesController],
      providers: [{ provide: PublicReceivableSharesService, useValue: {} }],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    const config = new DocumentBuilder().setTitle('Personal OS API').build();

    document = SwaggerModule.createDocument(
      app,
      config,
    ) as unknown as OpenApiDocument;
  });

  it('publishes the public share schema with decimal money', () => {
    const schema =
      document.paths['/api/public/receivable-shares/{token}']?.get?.responses?.[
        '200'
      ]?.content?.['application/json']?.schema;
    const item = document.components?.schemas?.PublicShareItemResponseDto as {
      properties?: Record<string, { type?: string }>;
    };

    expect(schema).toBeDefined();
    for (const field of ['amount', 'paid', 'pending']) {
      expect(item.properties?.[field]).toMatchObject({ type: 'string' });
    }
  });
});
