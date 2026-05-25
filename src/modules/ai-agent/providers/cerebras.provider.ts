import Cerebras from '@cerebras/cerebras_cloud_sdk';
import {
  parseToolCallArguments,
  toolsToOpenAiFormat,
} from '../tools/tool.registry';
import type {
  AIService,
  AiToolDefinition,
  ChatCompletionResult,
  ChatMessage,
  ToolCallRequest,
} from '../utils/ai.types';
import { mapMessagesToOpenAi } from '../utils/map-messages-to-openai';

const CEREBRAS_MODEL = 'zai-glm-4.7';

export function createCerebrasProvider(apiKey: string): AIService {
  const cerebras = new Cerebras({ apiKey });

  return {
    name: 'Cerebras',
    model: CEREBRAS_MODEL,
    async chat(messages: ChatMessage[]) {
      const stream = await cerebras.chat.completions.create({
        messages: mapMessagesToOpenAi(messages),
        model: CEREBRAS_MODEL,
        stream: true,
        max_completion_tokens: 8192,
        temperature: 0.6,
        top_p: 0.95,
      });

      return (async function* () {
        for await (const chunk of stream as AsyncIterable<{
          choices: Array<{ delta?: { content?: string | null } }>;
        }>) {
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
      const response = await cerebras.chat.completions.create({
        messages: mapMessagesToOpenAi(messages),
        model: CEREBRAS_MODEL,
        max_completion_tokens: 8192,
        temperature: 0.6,
        tools: tools?.length ? toolsToOpenAiFormat(tools) : undefined,
        tool_choice: tools?.length ? 'auto' : undefined,
      });

      const choice = (response as { choices: Array<{ message?: {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      } }> }).choices[0]?.message;

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
