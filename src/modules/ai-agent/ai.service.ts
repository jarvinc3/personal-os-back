import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AI_PROVIDER } from './utils/ai-provider.token';
import type {
  AIService as AIProviderClient,
  AIProviderInfo,
  ChatMessage,
} from './utils/ai.types';
import { isRetryableProviderError } from './utils/is-retryable-provider-error';

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private roundRobinIndex = 0;

  constructor(
    @Inject(AI_PROVIDER)
    private readonly providers: AIProviderClient[],
  ) {}

  onModuleInit(): void {
    if (this.providers.length === 0) {
      if (process.env.NODE_ENV === 'test') {
        this.logger.warn('AI providers skipped in test mode');
        return;
      }

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

  private getRotatedProviders(): AIProviderClient[] {
    const count = this.providers.length;
    const start = this.roundRobinIndex;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % count;

    return Array.from(
      { length: count },
      (_, i) => this.providers[(start + i) % count],
    );
  }
}
