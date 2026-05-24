import Cerebras from '@cerebras/cerebras_cloud_sdk';
import type {
  AiToolDefinition,
  AIService,
  ChatCompletionResult,
  ChatMessage,
  ToolCallRequest,
} from '../utils/ai.types';
import { parseToolCallArguments, toolsToOpenAiFormat } from '../tools/tool.registry';

const CEREBRAS_MODEL = 'llama3.1-8b';

export function createCerebrasProvider(apiKey: string): AIService {
  const cerebras = new Cerebras({ apiKey });

  return {
    name: 'Cerebras',
    model: CEREBRAS_MODEL,
    async chat(messages: ChatMessage[]) {
      const stream = await cerebras.chat.completions.create({
        messages: messages as Parameters<
          typeof cerebras.chat.completions.create
        >[0]['messages'],
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
        messages: messages.filter((m) => m.role !== 'tool') as Parameters<
          typeof cerebras.chat.completions.create
        >[0]['messages'],
        model: CEREBRAS_MODEL,
        max_completion_tokens: 8192,
        temperature: 0.6,
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
