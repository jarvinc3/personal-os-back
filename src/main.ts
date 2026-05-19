import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';
import { isBullMqEnabled } from './config/redis.config';
import type { Env } from './config/env.schema';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app: INestApplication = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const configService = app.get(ConfigService<Env, true>);

  const nodeEnv = configService.get('NODE_ENV', { infer: true });
  const isProduction = nodeEnv === 'production';
  const redisUrl = configService.get('REDIS_URL', { infer: true });
  const redisEnabled = configService.get('REDIS_ENABLED', { infer: true });
  const bullMqEnabled = isBullMqEnabled({
    NODE_ENV: nodeEnv,
    REDIS_URL: redisUrl,
    REDIS_ENABLED: redisEnabled,
  });

  if (nodeEnv === 'development' && !bullMqEnabled) {
    logger.warn(
      'BullMQ is disabled in development. To enable: start Redis (docker run -d -p 6379:6379 --name personal-os-redis redis:7-alpine), then set REDIS_ENABLED=true and REDIS_URL=redis://localhost:6379',
    );
  }
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

  const corsOrigins = corsOrigin
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  app.enableCors({
    origin: isProduction
      ? corsOrigins.length === 1
        ? corsOrigins[0]
        : corsOrigins
      : (origin, callback) => {
          // En desarrollo: Expo Go / React Native suelen omitir Origin; permitir todo.
          callback(null, true);
        },
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
    .setTitle('Personal OS API')
    .setDescription(
      'Personal OS backend endpoints, including auth, core modules, and AI.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addTag('health')
    .addTag('auth')
    .addTag('users')
    .addTag('notifications')
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

  await app.listen(port, '0.0.0.0');

  const basePath = apiPrefix.length > 0 ? `/${apiPrefix}` : '';
  logger.log(`CORS Origin: ${corsOrigin} isProduction: ${isProduction}`);
  logger.log(`Application is running on: http://0.0.0.0:${port}${basePath}`);
  logger.log(`LAN access example: http://<your-ip>:${port}${basePath}`);
}

bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error(
    'Failed to bootstrap application',
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});
