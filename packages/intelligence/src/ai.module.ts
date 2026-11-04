import { Module } from '@nestjs/common';
import { AiCoreModule } from './ai-core.module';
@Module({ imports: [AiCoreModule], exports: [AiCoreModule] })
export class AiModule {}
