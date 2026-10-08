export { AiCoreModule } from './ai-core.module';
export { AiService } from './chat/application/ai.service';
export { AiSessionsService } from './chat/application/ai-sessions.service';
// AiModule last: it imports Finance, which can load this barrel again for AiService.
export { AiModule } from './ai.module';
