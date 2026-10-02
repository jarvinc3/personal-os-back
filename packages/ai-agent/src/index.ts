export { AiCoreModule } from './ai-core.module';
export { AiService } from './chat/application/ai.service';
// AiModule last: it imports Finance, which can load this barrel again for AiService.
export { AiModule } from './ai.module';
