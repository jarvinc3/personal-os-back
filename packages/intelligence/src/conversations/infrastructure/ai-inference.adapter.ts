import { Injectable } from '@nestjs/common';
import type {
  AiConversationCompletion,
  AiConversationInferencePort,
  AiConversationMessage,
  AiConversationStreamRequest,
  AiToolCall,
  AiToolSpec,
  JsonObject,
} from '@personal-os/contracts';
import { AiService } from '../../inference/application/ai.service';
import type {
  AiToolDefinition,
  ChatCompletionResult,
  ChatMessage,
} from '../../shared/ai.types';

function toAgentToolCalls(
  calls: readonly { id: string; name: string; arguments: unknown }[],
): AiToolCall[] {
  return calls.map((call) => {
    if (
      !call.arguments ||
      typeof call.arguments !== 'object' ||
      Array.isArray(call.arguments)
    ) {
      throw new Error('AI provider returned invalid tool arguments');
    }
    return {
      id: call.id,
      name: call.name,
      arguments: JSON.parse(JSON.stringify(call.arguments)) as JsonObject,
    };
  });
}

function toProviderTools(
  tools?: readonly AiToolSpec[],
): AiToolDefinition[] | undefined {
  return tools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    mutating: tool.effect === 'WRITE',
    targetModule: tool.moduleSlug,
  }));
}

function toAgentCompletion(
  completion: ChatCompletionResult & { provider: string; model: string },
): AiConversationCompletion {
  return {
    content: completion.content,
    toolCalls: toAgentToolCalls(completion.toolCalls),
    provider: completion.provider,
    model: completion.model,
  };
}

@Injectable()
export class AiInferenceAdapter implements AiConversationInferencePort {
  constructor(private readonly inference: AiService) {}

  async complete(
    messages: readonly AiConversationMessage[],
    tools?: readonly AiToolSpec[],
  ): Promise<AiConversationCompletion> {
    const completion = await this.inference.chatComplete(
      messages as ChatMessage[],
      undefined,
      toProviderTools(tools),
    );
    return toAgentCompletion(completion);
  }

  async stream({
    messages,
    tools,
    signal,
    onContent,
    onReset,
  }: AiConversationStreamRequest): Promise<AiConversationCompletion> {
    const completion = await this.inference.chatStream({
      messages: messages as ChatMessage[],
      tools: toProviderTools(tools),
      signal,
      onContent,
      onReset,
    });
    return toAgentCompletion(completion);
  }

  async summarize(messages: readonly AiConversationMessage[]): Promise<string> {
    const completion = await this.complete([
      {
        role: 'system',
        content:
          'Resume esta conversación para retomarla después. Conserva solo hechos, preferencias y tareas que el usuario aportó. No inventes. No conviertas el resumen en conocimiento global. Devuelve texto breve en español.',
      },
      ...messages,
    ]);
    return completion.content.trim();
  }
}
