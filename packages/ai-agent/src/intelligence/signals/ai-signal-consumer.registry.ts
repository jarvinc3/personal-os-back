import { Injectable } from '@nestjs/common';
import type { SignalConsumer } from '@personal-os/contracts';

@Injectable()
export class AiSignalConsumerRegistry {
  private readonly consumers = new Map<string, SignalConsumer>();

  register(consumer: SignalConsumer): void {
    const existing = this.consumers.get(consumer.domain);
    if (existing && existing !== consumer) {
      throw new Error(
        `AI signal consumer already registered for ${consumer.domain}`,
      );
    }
    this.consumers.set(consumer.domain, consumer);
  }

  get(domain: string): SignalConsumer {
    const consumer = this.consumers.get(domain);
    if (!consumer) {
      throw new Error(`No AI signal consumer registered for ${domain}`);
    }
    return consumer;
  }
}
