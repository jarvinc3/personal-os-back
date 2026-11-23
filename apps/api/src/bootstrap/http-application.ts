import { RequestMethod, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

const BULL_BOARD_ROUTES = [
  { path: 'admin/queues', method: RequestMethod.ALL },
  { path: 'admin/queues/{*path}', method: RequestMethod.ALL },
];

type ApplyHttpApplicationInput = {
  app: NestExpressApplication;
  apiPrefix: string;
};

export function applyHttpApplication({
  app,
  apiPrefix,
}: ApplyHttpApplicationInput): void {
  app.use(helmet());
  app.set('trust proxy', 1);
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });
  applyGlobalPrefix({ app, apiPrefix });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
}

function applyGlobalPrefix({
  app,
  apiPrefix,
}: ApplyHttpApplicationInput): void {
  if (apiPrefix.length === 0) {
    return;
  }
  app.setGlobalPrefix(apiPrefix, { exclude: BULL_BOARD_ROUTES });
}
