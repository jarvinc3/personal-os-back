import type { DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { BullBoardModule } from '@bull-board/nestjs';
import type { Env } from '../../config';
import { createBullBoardAuthMiddleware } from './bull-board-auth.middleware';
import { QueueNames } from './queue.constants';

export function getBullBoardImports(): DynamicModule[] {
  return [
    BullBoardModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        route: '/admin/queues',
        adapter: ExpressAdapter,
        middleware: createBullBoardAuthMiddleware(
          config.get('BULL_BOARD_USER', { infer: true }),
          config.get('BULL_BOARD_PASSWORD', { infer: true }),
        ),
      }),
    }),
    BullBoardModule.forFeature({
      name: QueueNames.NOTIFICATIONS,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QueueNames.AI_PROCESSING,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QueueNames.EMAIL_SYNC,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QueueNames.GMAIL_SYNC,
      adapter: BullMQAdapter,
    }),
  ];
}
