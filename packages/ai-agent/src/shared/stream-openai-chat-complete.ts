import {
  parseToolCallArguments,
  toolsToOpenAiFormat,
} from '../tools/tool.registry';
import type {
  AiToolDefinition,
  ChatCompletionResult,
  ChatMessage,
  ToolCallRequest,
} from './ai.types';
import { mapMessagesToOpenAi } from './map-messages-to-openai';

type OpenAiStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
};

type StreamCreateParams = {
  messages: ReturnType<typeof mapMessagesToOpenAi>;
  model: string;
  temperature?: number;
  max_completion_tokens?: number;
  top_p?: number;
  tools?: ReturnType<typeof toolsToOpenAiFormat>;
  tool_choice?: 'auto';
  stream: true;
};

export async function streamOpenAiChatComplete(
  create: (
    params: StreamCreateParams,
  ) => Promise<AsyncIterable<OpenAiStreamChunk>>,
  messages: ChatMessage[],
  tools: AiToolDefinition[] | undefined,
  onToken: (delta: string) => void,
  extra?: Pick<
    StreamCreateParams,
    'temperature' | 'max_completion_tokens' | 'top_p' | 'model'
  >,
): Promise<ChatCompletionResult> {
  const stream = await create({
    messages: mapMessagesToOpenAi(messages),
    model: extra?.model ?? '',
    temperature: extra?.temperature ?? 0.6,
    max_completion_tokens: extra?.max_completion_tokens,
    top_p: extra?.top_p,
    tools: tools?.length ? toolsToOpenAiFormat(tools) : undefined,
    tool_choice: tools?.length ? 'auto' : undefined,
    stream: true,
  });

  let content = '';
  const toolAcc = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) {
      continue;
    }

    if (delta.content) {
      content += delta.content;
      onToken(delta.content);
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const existing = toolAcc.get(tc.index) ?? {
          id: tc.id ?? '',
          name: tc.function?.name ?? '',
          arguments: '',
        };
        if (tc.id) {
          existing.id = tc.id;
        }
        if (tc.function?.name) {
          existing.name = tc.function.name;
        }
        if (tc.function?.arguments) {
          existing.arguments += tc.function.arguments;
        }
        toolAcc.set(tc.index, existing);
      }
    }
  }

  const toolCalls: ToolCallRequest[] = [...toolAcc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => ({
      id: tc.id,
      name: tc.name,
      arguments: parseToolCallArguments(tc.arguments),
    }))
    .filter((tc) => tc.id && tc.name);

  return { content, toolCalls };
}
