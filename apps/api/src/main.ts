import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import 'dotenv/config';
import { writeFileSync } from 'fs';
import helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app.module';
import { isBullMqEnabled } from '@personal-os/config';
import type { Env } from '@personal-os/config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.enableShutdownHooks();

  app.use(helmet());
  app.set('trust proxy', 1);
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

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
    app.setGlobalPrefix(apiPrefix, {
      exclude: [
        { path: 'admin/queues', method: RequestMethod.ALL },
        { path: 'admin/queues/{*path}', method: RequestMethod.ALL },
      ],
    });
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

  const port: number = configService.get('PORT', { infer: true }) ?? 3000;
  // Bull Board (same host) sends Origin on PUT/DELETE; allow the API's own origin in non-prod.
  const sameServerOrigins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ];

  app.enableCors({
    origin: isProduction
      ? corsOrigins.length === 1
        ? corsOrigins[0]
        : corsOrigins
      : (origin, callback) => {
          // Expo Go / React Native often omit Origin; allow missing Origin in non-prod.
          if (!origin) {
            callback(null, true);
            return;
          }
          if (
            corsOrigins.includes(origin) ||
            corsOrigins.includes('*') ||
            sameServerOrigins.includes(origin)
          ) {
            callback(null, true);
            return;
          }
          callback(new Error(`Origin ${origin} not allowed by CORS`), false);
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

  if (!isProduction) {
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

    writeFileSync(
      join(process.cwd(), 'swagger-spec.json'),
      JSON.stringify(document, null, 2),
    );
  }

  await app.listen(port, '0.0.0.0');

  const basePath = apiPrefix.length > 0 ? `/${apiPrefix}` : '';
  logger.log(`CORS Origin: ${corsOrigin} isProduction: ${isProduction}`);
  logger.log(`Application is running on: http://0.0.0.0:${port}${basePath}`);
  if (!isProduction && bullMqEnabled) {
    const boardUser = configService.get('BULL_BOARD_USER', { infer: true });
    const boardAuth =
      boardUser && configService.get('BULL_BOARD_PASSWORD', { infer: true })
        ? ' (basic auth enabled)'
        : '';
    logger.log(`Bull Board: http://0.0.0.0:${port}/admin/queues${boardAuth}`);
  }
}

bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error(
    'Failed to bootstrap application',
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});
