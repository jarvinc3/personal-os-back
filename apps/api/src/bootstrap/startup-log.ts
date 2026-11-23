import type { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';

type StartupLogInput = {
  logger: Logger;
  config: ConfigService<Env, true>;
  apiPrefix: string;
  port: number;
  corsOrigin: string;
  isProduction: boolean;
  bullMqEnabled: boolean;
};

export function logStartup({
  logger,
  config,
  apiPrefix,
  port,
  corsOrigin,
  isProduction,
  bullMqEnabled,
}: StartupLogInput): void {
  const basePath = apiPrefix.length > 0 ? `/${apiPrefix}` : '';
  logger.log(`CORS Origin: ${corsOrigin} isProduction: ${isProduction}`);
  logger.log(`Application is running on: http://0.0.0.0:${port}${basePath}`);

  if (isProduction || !bullMqEnabled) {
    return;
  }

  const boardUser = config.get('BULL_BOARD_USER', { infer: true });
  const boardPassword = config.get('BULL_BOARD_PASSWORD', { infer: true });
  const boardAuth = boardUser && boardPassword ? ' (basic auth enabled)' : '';
  logger.log(`Bull Board: http://0.0.0.0:${port}/admin/queues${boardAuth}`);
}

type BullMqWarningInput = {
  logger: Logger;
  nodeEnv: Env['NODE_ENV'];
  bullMqEnabled: boolean;
};

export function warnIfBullMqDisabled({
  logger,
  nodeEnv,
  bullMqEnabled,
}: BullMqWarningInput): void {
  if (nodeEnv !== 'development' || bullMqEnabled) {
    return;
  }
  logger.warn(
    'BullMQ is disabled in development. To enable: start Redis (docker run -d -p 6379:6379 --name personal-os-redis redis:7-alpine), then set REDIS_ENABLED=true and REDIS_URL=redis://localhost:6379',
  );
}
