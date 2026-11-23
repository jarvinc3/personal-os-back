import { Injectable, type OnModuleInit } from '@nestjs/common';
import { FinanceSignalConsumer } from '@personal-os/finance';
import { AiSignalConsumerRegistry } from '@personal-os/intelligence';

@Injectable()
export class AiSignalConsumerCompositionService implements OnModuleInit {
  constructor(
    private readonly registry: AiSignalConsumerRegistry,
    private readonly finance: FinanceSignalConsumer,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.finance);
  }
}
