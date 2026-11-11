import { OpenRouter } from '@openrouter/sdk';
import type {
  AiToolDefinition,
  AIService,
  ChatCompletionResult,
  ChatMessage,
  ToolCallRequest,
} from '../shared/ai.types';
import { mapMessagesToOpenRouter } from '../shared/map-messages-to-openrouter';
import {
  parseToolCallArguments,
  toolsToOpenAiFormat,
} from '../shared/provider-tool-codec';

const OPENROUTER_MODEL = 'deepseek/deepseek-v4-flash';
/**
 * Sin un límite explícito OpenRouter reserva el máximo del modelo (131072
 * tokens) y rechaza la llamada con 402 cuando el saldo no lo cubre, aunque el
 * uso real sea mínimo. El mismo valor que usa Groq mantiene el respaldo útil.
 */
const OPENROUTER_MAX_TOKENS = 4096;

export function createOpenRouterProvider(apiKey: string): AIService {
  const openrouter = new OpenRouter({ apiKey });

  return {
    name: 'OpenRouter',
    model: OPENROUTER_MODEL,
    async chatComplete(
      messages: ChatMessage[],
      tools?: AiToolDefinition[],
    ): Promise<ChatCompletionResult> {
      const response = await openrouter.chat.send({
        chatRequest: {
          model: OPENROUTER_MODEL,
          messages: mapMessagesToOpenRouter(messages),
          stream: false,
          tools: tools?.length ? toolsToOpenAiFormat(tools) : undefined,
          toolChoice: tools?.length ? 'auto' : undefined,
          maxTokens: OPENROUTER_MAX_TOKENS,
        },
      });

      const choice = response.choices[0]?.message as {
        content?: string | null;
        toolCalls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
        tool_calls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      };

      const rawToolCalls = choice?.toolCalls ?? choice?.tool_calls ?? [];
      const toolCalls: ToolCallRequest[] = rawToolCalls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: parseToolCallArguments(tc.function.arguments),
      }));

      return {
        content: choice?.content ?? '',
        toolCalls,
        usage: (() => {
          const usage = (
            response as unknown as {
              usage?: {
                promptTokens?: number;
                completionTokens?: number;
              };
            }
          ).usage;
          return usage
            ? {
                inputTokens: usage.promptTokens,
                outputTokens: usage.completionTokens,
              }
            : undefined;
        })(),
      };
    },
  };
}
