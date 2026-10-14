import { Module } from '@nestjs/common';
import { ChatContextEntityService } from './application/chat-context-entity.service';

@Module({
  providers: [ChatContextEntityService],
  exports: [ChatContextEntityService],
})
export class FinanceChatContextModule {}
