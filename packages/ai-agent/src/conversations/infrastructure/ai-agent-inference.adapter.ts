import { Injectable } from '@nestjs/common';
import type {
  AiAgentInferencePort,
  AiAgentMessage,
  AiAgentToolCall,
  AiAgentToolDefinition,
  JsonObject,
} from '@personal-os/contracts';
import { AiService } from '../../inference/application/ai.service';
import type { AiToolDefinition, ChatMessage } from '../../shared/ai.types';

function toAgentToolCalls(
  calls: readonly { id: string; name: string; arguments: unknown }[],
): AiAgentToolCall[] {
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
export class AiAgentInferenceAdapter implements AiAgentInferencePort {
  constructor(private readonly inference: AiService) {}

  async complete(
    messages: readonly AiAgentMessage[],
    tools?: readonly AiAgentToolDefinition[],
  ) {
    const providerTools: AiToolDefinition[] | undefined = tools?.map(
      (tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        mutating: false,
        targetModule: 'ai-capability',
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

  async summarize(messages: readonly AiAgentMessage[]): Promise<string> {
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
