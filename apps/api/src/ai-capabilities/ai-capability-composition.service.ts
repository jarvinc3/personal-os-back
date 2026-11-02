import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import {
  AI_CAPABILITY_PROVIDERS,
  AI_CAPABILITY_REGISTRY,
  type AiCapabilityProvider,
  type AiCapabilityRegistryPort,
} from '@personal-os/contracts';

@Injectable()
export class AiCapabilityCompositionService implements OnModuleInit {
  constructor(
    @Inject(AI_CAPABILITY_REGISTRY)
    private readonly registry: AiCapabilityRegistryPort,
    @Inject(AI_CAPABILITY_PROVIDERS)
    private readonly providers: readonly AiCapabilityProvider[],
  ) {}

  onModuleInit(): void {
    for (const provider of this.providers) {
      this.registry.register(provider);
    }
  }
}
