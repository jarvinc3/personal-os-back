import type { FactoryProvider } from '@nestjs/common';
import {
  AI_CAPABILITY_PROVIDERS,
  type AiCapabilityProvider,
} from '@personal-os/contracts';
import { FinanceAiCapabilities } from '@personal-os/finance';

export const AI_CAPABILITY_PROVIDERS_DEFINITION: FactoryProvider<
  readonly AiCapabilityProvider[]
> = {
  provide: AI_CAPABILITY_PROVIDERS,
  useFactory: (
    finance: FinanceAiCapabilities,
  ): readonly AiCapabilityProvider[] => [finance],
  inject: [FinanceAiCapabilities],
};
