import { OpenRouter } from '@openrouter/sdk';
import type {
  AiToolDefinition,
  AIService,
  ChatCompletionResult,
  ChatMessage,
  ToolCallRequest,
} from '../utils/ai.types';
import { parseToolCallArguments, toolsToOpenAiFormat } from '../tools/tool.registry';

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
          messages: messages.map((m) => ({
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
          messages: messages
            .filter((m) => m.role !== 'tool')
            .map((m) => ({
              role: m.role as 'user' | 'assistant' | 'system',
              content: m.content,
            })),
          stream: false,
          tools: tools?.length ? toolsToOpenAiFormat(tools) : undefined,
        },
      });

      const choice = response.choices[0]?.message as {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      };

      const toolCalls: ToolCallRequest[] =
        choice?.tool_calls?.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: parseToolCallArguments(tc.function.arguments),
        })) ?? [];

      return {
        content: choice?.content ?? '',
        toolCalls,
      };
    },
  };
}
