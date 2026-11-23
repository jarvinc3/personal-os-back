import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DIAGRAMS_DIR = '.archify';
const DIAGRAMS_URL_PATH = 'docs/diagramas';

type MountDiagramAssetsInput = {
  app: NestExpressApplication;
  logger: Logger;
  port: number;
};

export function mountDiagramAssets({
  app,
  logger,
  port,
}: MountDiagramAssetsInput): void {
  const diagramsDir = join(process.cwd(), DIAGRAMS_DIR);
  if (!existsSync(diagramsDir)) {
    logger.warn(
      `No diagrams found in ${diagramsDir}; /${DIAGRAMS_URL_PATH} stays unmounted.`,
    );
    return;
  }

  app.useStaticAssets(diagramsDir, { prefix: `/${DIAGRAMS_URL_PATH}` });
  logger.log(`Diagrams: http://0.0.0.0:${port}/${DIAGRAMS_URL_PATH}/`);
}
