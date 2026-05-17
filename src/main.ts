import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';
import type { Env } from './config/env.schema';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app: INestApplication = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const configService = app.get(ConfigService<Env, true>);

  const nodeEnv = configService.get('NODE_ENV', { infer: true });
  const isProduction = nodeEnv === 'production';
  const corsOrigin: string = configService.get('CORS_ORIGIN', { infer: true });

  if (isProduction && corsOrigin === '*') {
    throw new Error(
      `In production CORS_ORIGIN must be set to the exact frontend origin.`,
    );
  }

  // Global prefixes and pipes
  const apiPrefix: string =
    configService.get('API_PREFIX', { infer: true }) ?? 'api';
  if (apiPrefix.length > 0) {
    app.setGlobalPrefix(apiPrefix);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-request-id',
      'x-business-id',
      'x-organization-id',
      'Accept',
    ],
    credentials: true,
  });

  // Swagger integration
  const openApiConfig = new DocumentBuilder()
    .setTitle('TurnApp API')
    .setDescription('TurnApp Backend Endpoints')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addTag('health')
    .addTag('auth')
    .addTag('finances')
    .addTag('ai-agent')
    .build();

  const document = SwaggerModule.createDocument(app, openApiConfig);
  const swaggerPath: string =
    configService.get('SWAGGER_PATH', { infer: true }) ?? 'docs';
  SwaggerModule.setup(swaggerPath, app, document);

  // Auto-generate swagger.json at root for postman sync
  writeFileSync(
    join(process.cwd(), 'swagger-spec.json'),
    JSON.stringify(document, null, 2),
  );

  const port: number = configService.get('PORT', { infer: true }) ?? 3000;

  await app.listen(port);

  const basePath = apiPrefix.length > 0 ? `/${apiPrefix}` : '';
  logger.log(`CORS Origin: ${corsOrigin} isProduction: ${isProduction}`);
  logger.log(`Application is running on: http://localhost:${port}${basePath}`);
}

bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error(
    'Failed to bootstrap application',
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});
