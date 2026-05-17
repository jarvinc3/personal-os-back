import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import type {
  AIProviderInfo,
  AIService,
  ChatMessage,
} from '../../core/types/ai.types';
import { createCerebrasProvider } from './providers/cerebras.provider';
import { createGroqProvider } from './providers/groq.provider';
import { createOpenRouterProvider } from './providers/openrouter.provider';
import { isRetryableProviderError } from './utils/is-retryable-provider-error';

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private readonly providers: AIService[] = [];
  private roundRobinIndex = 0;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    const groqKey = this.config.get('GROQ_API_KEY', { infer: true });
    const cerebrasKey = this.config.get('CEREBRAS_API_KEY', { infer: true });
    const openRouterKey = this.config.get('OPENROUTER_API_KEY', {
      infer: true,
    });

    if (groqKey) {
      this.providers.push(createGroqProvider(groqKey));
    }
    if (cerebrasKey) {
      this.providers.push(createCerebrasProvider(cerebrasKey));
    }
    if (openRouterKey) {
      this.providers.push(createOpenRouterProvider(openRouterKey));
    }

    if (this.providers.length === 0) {
      throw new Error(
        'No AI providers configured. Set at least one of: GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY.',
      );
    }

    this.logger.log(
      `AI pool ready (${this.providers.length}): ${this.providers.map((p) => `${p.name} (${p.model})`).join(', ')}`,
    );
  }

  getProviders(): AIProviderInfo[] {
    return this.providers.map((p) => ({ name: p.name, model: p.model }));
  }

  async chat(messages: ChatMessage[]): Promise<{
    provider: string;
    model: string;
    stream: AsyncIterable<string>;
  }> {
    if (this.providers.length === 0) {
      throw new ServiceUnavailableException('No AI providers available');
    }

    const ordered = this.getRotatedProviders();
    let lastError: unknown;

    for (const provider of ordered) {
      try {
        this.logger.debug(`Trying AI provider: ${provider.name}`);
        const stream = await provider.chat(messages);
        return {
          provider: provider.name,
          model: provider.model,
          stream,
        };
      } catch (error) {
        lastError = error;
        if (!isRetryableProviderError(error)) {
          throw error;
        }
        this.logger.warn(
          `Provider ${provider.name} unavailable, trying next: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const message =
      lastError instanceof Error ? lastError.message : 'Unknown error';
    throw new ServiceUnavailableException(
      `All AI providers failed. Last error: ${message}`,
    );
  }

  private getRotatedProviders(): AIService[] {
    const count = this.providers.length;
    const start = this.roundRobinIndex;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % count;

    return Array.from(
      { length: count },
      (_, i) => this.providers[(start + i) % count],
    );
  }
}
