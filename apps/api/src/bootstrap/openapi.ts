import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Env } from '@personal-os/config';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appVersion } from '../app-version';

const SWAGGER_SPEC_FILE = 'swagger-spec.json';
const DEFAULT_SWAGGER_PATH = 'docs';

type SetupOpenApiInput = {
  app: INestApplication;
  config: ConfigService<Env, true>;
};

export function setupOpenApiDocument({ app, config }: SetupOpenApiInput): void {
  const openApiConfig = new DocumentBuilder()
    .setTitle('Personal OS API')
    .setDescription(
      'Personal OS backend endpoints, including auth, core modules, and AI.',
    )
    .setVersion(appVersion())
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addTag('health')
    .addTag('auth')
    .addTag('users')
    .addTag('notifications')
    .addTag('finances')
    .addTag('intelligence')
    .build();

  const document = SwaggerModule.createDocument(app, openApiConfig);
  const swaggerPath =
    config.get('SWAGGER_PATH', { infer: true }) ?? DEFAULT_SWAGGER_PATH;
  SwaggerModule.setup(swaggerPath, app, document);

  writeFileSync(
    join(process.cwd(), SWAGGER_SPEC_FILE),
    JSON.stringify(document, null, 2),
  );
}
