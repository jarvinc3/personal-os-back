import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { UsersService } from '../application/users.service';
import { WipeUserDataUseCase } from '../application/wipe-user-data.use-case';
import { UsersController } from './users.controller';

type OperationObject = {
  responses?: Record<
    string,
    { content?: Record<string, { schema?: Record<string, unknown> }> }
  >;
};

type OpenApiDocument = {
  paths: Record<string, Record<string, OperationObject>>;
  components?: { schemas?: Record<string, unknown> };
};

async function buildDocument(): Promise<OpenApiDocument> {
  const moduleRef = await Test.createTestingModule({
    controllers: [UsersController],
    providers: [
      { provide: UsersService, useValue: {} },
      { provide: WipeUserDataUseCase, useValue: {} },
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
  return (
    operation?.responses?.['200']?.content?.['application/json']?.schema ??
    operation?.responses?.['201']?.content?.['application/json']?.schema
  );
}

describe('OpenAPI response schemas of the users profile', () => {
  let document: OpenApiDocument;

  beforeAll(async () => {
    document = await buildDocument();
  });

  it('publishes a schema for every 2xx response', () => {
    const operations = [
      ['/api/users/me', 'get'],
      ['/api/users/me', 'patch'],
      ['/api/users/me', 'delete'],
      ['/api/users/me/release-notes-seen', 'patch'],
      ['/api/users/me/modules/{slug}', 'patch'],
      ['/api/users/me/data/branches', 'get'],
      ['/api/users/me/data/wipe', 'post'],
    ];

    const missing = operations.filter(
      ([path, method]) =>
        successSchema({ document, path, method }) === undefined,
    );

    expect(missing).toEqual([]);
  });

  it('publishes the profile, modules and wipe result', () => {
    const profile = document.components?.schemas?.UserProfileResponseDto as {
      properties?: Record<string, unknown>;
    };
    const wipe = document.components?.schemas?.WipeUserDataResponseDto as {
      properties?: Record<string, unknown>;
    };

    expect(profile.properties).toHaveProperty('userModules');
    expect(profile.properties).toHaveProperty('preferences');
    expect(wipe.properties).toHaveProperty('appliedBranches');
    expect(wipe.properties).toHaveProperty('counts');
    expect(
      document.components?.schemas?.DataAppBranchesResponseDto,
    ).toBeDefined();
  });
});
