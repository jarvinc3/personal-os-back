import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  InferenceCompletion,
  InferenceMessage,
} from '@personal-os/contracts';
import { AI_PROVIDER } from '../../shared/ai-provider.token';
import type {
  AIService as AIProviderClient,
  AiToolDefinition,
  ChatCompletionResult,
  ChatMessage,
} from '../../shared/ai.types';
import { isRetryableProviderError } from '../../shared/is-retryable-provider-error';
import {
  buildProviderFailureLogDetails,
  providerFailureLogMessage,
  sanitizeProviderErrorMessage,
} from '../../shared/provider-failure';

type ChatStreamOptions = {
  messages: ChatMessage[];
  tools?: AiToolDefinition[];
  preferredProvider?: string | null;
  signal?: AbortSignal;
  onContent: (chunk: string) => void;
  onReset?: () => void;
};

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
        'No AI providers configured. Set at least one of: GROQ_API_KEY, OPENROUTER_API_KEY.',
      );
    }

    this.logger.log(
      `AI pool ready (${this.providers.length}): ${this.providers.map((p) => `${p.name} (${p.model})`).join(', ')}`,
    );
  }

  async complete(
    messages: readonly InferenceMessage[],
  ): Promise<InferenceCompletion> {
    const { content, provider, model } = await this.chatComplete([...messages]);
    return { content, provider, model };
  }

  async chatComplete(
    messages: ChatMessage[],
    preferredProvider?: string | null,
    tools?: AiToolDefinition[],
  ): Promise<ChatCompletionResult & { provider: string; model: string }> {
    if (this.providers.length === 0) {
      throw new ServiceUnavailableException(
        'No hay proveedores de IA disponibles',
      );
    }

    const ordered = this.getOrderedProviders(preferredProvider);
    const capableProviderCount = ordered.filter((provider) =>
      Boolean(provider.chatComplete),
    ).length;
    let attempts = 0;
    let lastError: unknown;

    for (const provider of ordered) {
      if (!provider.chatComplete) {
        continue;
      }
      attempts += 1;
      try {
        this.logger.debug(`Trying AI provider (complete): ${provider.name}`);
        const result = await provider.chatComplete(messages, tools);
        return {
          ...result,
          provider: provider.name,
          model: provider.model,
        };
      } catch (error) {
        lastError = error;
        const retryable = isRetryableProviderError(error);
        this.logProviderFailure({
          error,
          provider,
          retryable,
          fallback: retryable && attempts < capableProviderCount,
        });
        if (!retryable) {
          throw error;
        }
      }
    }

    throw this.allProvidersFailed(lastError);
  }

  /**
   * Transmite la respuesta del proveedor. Si un proveedor falla después de
   * emitir texto, el cliente recibe un reset antes de probar el siguiente.
   */
  async chatStream({
    messages,
    tools,
    preferredProvider,
    signal,
    onContent,
    onReset,
  }: ChatStreamOptions): Promise<
    ChatCompletionResult & { provider: string; model: string }
  > {
    if (this.providers.length === 0) {
      throw new ServiceUnavailableException(
        'No hay proveedores de IA disponibles',
      );
    }

    const ordered = this.getOrderedProviders(preferredProvider);
    const capableProviders = ordered.filter((provider) =>
      Boolean(provider.chatStream),
    );
    if (capableProviders.length === 0) {
      return this.streamViaComplete({
        messages,
        tools,
        preferredProvider,
        onContent,
      });
    }

    let attempts = 0;
    let lastError: unknown;
    for (const provider of capableProviders) {
      attempts += 1;
      let emitted = false;
      try {
        this.logger.debug(`Trying AI provider (stream): ${provider.name}`);
        const completion = await provider.chatStream!({
          messages,
          tools,
          signal,
          onContent: (chunk) => {
            emitted = true;
            onContent(chunk);
          },
        });
        return {
          ...completion,
          provider: provider.name,
          model: provider.model,
        };
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }
        if (emitted) {
          onReset?.();
        }
        lastError = error;
        const retryable = isRetryableProviderError(error);
        this.logProviderFailure({
          error,
          provider,
          retryable,
          fallback: retryable && attempts < capableProviders.length,
        });
        if (!retryable) {
          throw error;
        }
      }
    }

    throw this.allProvidersFailed(lastError);
  }

  private async streamViaComplete({
    messages,
    tools,
    preferredProvider,
    onContent,
  }: Pick<
    ChatStreamOptions,
    'messages' | 'tools' | 'preferredProvider' | 'onContent'
  >): Promise<ChatCompletionResult & { provider: string; model: string }> {
    const completion = await this.chatComplete(
      [...messages],
      preferredProvider,
      tools,
    );
    if (completion.content) {
      onContent(completion.content);
    }
    return completion;
  }

  private logProviderFailure({
    error,
    provider,
    retryable,
    fallback,
  }: {
    error: unknown;
    provider: AIProviderClient;
    retryable: boolean;
    fallback: boolean;
  }): void {
    const failure = buildProviderFailureLogDetails({
      error,
      provider: provider.name,
      model: provider.model,
      retryable,
      fallback,
    });
    this.logger.warn(providerFailureLogMessage(failure));
  }

  private allProvidersFailed(lastError: unknown): ServiceUnavailableException {
    const message =
      lastError instanceof Error
        ? (sanitizeProviderErrorMessage(lastError) ?? 'Unknown error')
        : 'Unknown error';
    return new ServiceUnavailableException(
      `Todos los proveedores de IA fallaron. Último error: ${message}`,
    );
  }

  private getOrderedProviders(
    preferredProvider?: string | null,
  ): AIProviderClient[] {
    const rotated = this.getRotatedProviders();

    if (!preferredProvider) {
      return rotated;
    }

    const normalized = preferredProvider.trim().toLowerCase();
    const preferred = rotated.find((p) => p.name.toLowerCase() === normalized);
    if (!preferred) {
      return rotated;
    }

    return [preferred, ...rotated.filter((p) => p.name !== preferred.name)];
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
