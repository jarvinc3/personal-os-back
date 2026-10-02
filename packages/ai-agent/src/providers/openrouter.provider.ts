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
} from '../tools/tool.registry';

const OPENROUTER_MODEL = 'deepseek/deepseek-v4-flash';

export function createOpenRouterProvider(apiKey: string): AIService {
  const openrouter = new OpenRouter({ apiKey });

  return {
    name: 'OpenRouter',
    model: OPENROUTER_MODEL,
    async chat(messages: ChatMessage[]) {
      const stream = await openrouter.chat.send({
        chatRequest: {
          model: OPENROUTER_MODEL,
          messages: messages
            .filter((m) => m.role !== 'tool')
            .map((m) => ({
              role: m.role as 'user' | 'assistant' | 'system',
              content: m.content,
            })),
          stream: true,
        },
      });

      return (async function* () {
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            yield content;
          }
        }
      })();
    },
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
      };
    },
  };
}
