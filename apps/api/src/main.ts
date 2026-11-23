import './instrument';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import 'dotenv/config';
import { isBullMqEnabled } from '@personal-os/config';
import type { Env } from '@personal-os/config';
import { AppModule } from './app.module';
import { mountDiagramAssets } from './bootstrap/diagram-assets';
import { applyHttpApplication } from './bootstrap/http-application';
import { setupOpenApiDocument } from './bootstrap/openapi';
import { logStartup, warnIfBullMqDisabled } from './bootstrap/startup-log';
import { buildCorsConfiguration } from './cors';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.enableShutdownHooks();

  const configService = app.get(ConfigService<Env, true>);
  const nodeEnv = configService.get('NODE_ENV', { infer: true });
  const isProduction = nodeEnv === 'production';
  const apiPrefix: string =
    configService.get('API_PREFIX', { infer: true }) ?? 'api';
  const port: number = configService.get('PORT', { infer: true }) ?? 3100;
  const corsOrigin: string = configService.get('CORS_ORIGIN', {
    infer: true,
  });
  const bullMqEnabled = isBullMqEnabled({
    NODE_ENV: nodeEnv,
    REDIS_URL: configService.get('REDIS_URL', { infer: true }),
    REDIS_ENABLED: configService.get('REDIS_ENABLED', { infer: true }),
  });

  warnIfBullMqDisabled({ logger, nodeEnv, bullMqEnabled });
  applyHttpApplication({ app, apiPrefix });
  // Diagrams are static documentation and need no CORS headers.
  if (!isProduction) {
    mountDiagramAssets({ app, logger, port });
  }
  app.enableCors(
    buildCorsConfiguration({
      isProduction,
      corsOrigin,
      corsOriginPatterns: configService.get('CORS_ORIGIN_PATTERNS', {
        infer: true,
      }),
      port,
    }),
  );

  if (!isProduction) {
    setupOpenApiDocument({ app, config: configService });
  }

  await app.listen(port, '0.0.0.0');

  logStartup({
    logger,
    config: configService,
    apiPrefix,
    port,
    corsOrigin,
    isProduction,
    bullMqEnabled,
  });
}

bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error(
    'Failed to bootstrap application',
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});
