import { Injectable } from '@nestjs/common';
import type {
  AiConversationInferencePort,
  AiConversationMessage,
  AiToolCall,
  AiToolSpec,
  JsonObject,
} from '@personal-os/contracts';
import { AiService } from '../../inference/application/ai.service';
import type { AiToolDefinition, ChatMessage } from '../../shared/ai.types';

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

@Injectable()
export class AiInferenceAdapter implements AiConversationInferencePort {
  constructor(private readonly inference: AiService) {}

  async complete(
    messages: readonly AiConversationMessage[],
    tools?: readonly AiToolSpec[],
  ) {
    const providerTools: AiToolDefinition[] | undefined = tools?.map(
      (tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        mutating: tool.effect === 'WRITE',
        targetModule: tool.moduleSlug,
      }),
    );
    const result = await this.inference.chatComplete(
      messages as ChatMessage[],
      undefined,
      providerTools,
    );
    return {
      content: result.content,
      toolCalls: toAgentToolCalls(result.toolCalls),
      provider: result.provider,
      model: result.model,
    };
  }

  async summarize(messages: readonly AiConversationMessage[]): Promise<string> {
    const result = await this.complete([
      {
        role: 'system',
        content:
          'Resume esta conversación para retomarla después. Conserva solo hechos, preferencias y tareas que el usuario aportó. No inventes. No conviertas el resumen en conocimiento global. Devuelve texto breve en español.',
      },
      ...messages,
    ]);
    return result.content.trim();
  }
}
