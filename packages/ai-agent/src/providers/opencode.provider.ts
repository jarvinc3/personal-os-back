import OpenAI from 'openai';
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
} from '../shared/ai.types';
import { mapMessagesToOpenAi } from '../shared/map-messages-to-openai';
import { streamOpenAiChatComplete } from '../shared/stream-openai-chat-complete';

/** OpenCode Zen serves the free model through an OpenAI-compatible endpoint. */
const OPENCODE_BASE_URL = 'https://opencode.ai/inference/openai/v1';
const OPENCODE_MODEL = 'deepseek-v4.1-flash-free';
const OPENCODE_NAME = 'OpenCode';

/**
 * The shared mapper returns the loose OpenAI shape the Groq SDK accepts.
 * The OpenAI client types every message, so map once here instead of tainting
 * the shared helper with a provider-specific cast.
 */
function toOpenAiMessages(messages: ChatMessage[]) {
  return mapMessagesToOpenAi(
    messages,
  ) as OpenAI.Chat.ChatCompletionMessageParam[];
}

export function createOpenCodeProvider(apiKey: string): AIService {
  const opencode = new OpenAI({ apiKey, baseURL: OPENCODE_BASE_URL });

  return {
    name: OPENCODE_NAME,
    model: OPENCODE_MODEL,
    async chat(messages: ChatMessage[]) {
      const stream = await opencode.chat.completions.create({
        messages: toOpenAiMessages(messages),
        model: OPENCODE_MODEL,
        temperature: 0.6,
        max_completion_tokens: 4096,
        top_p: 1,
        stream: true,
      });

      return (async function* () {
        for await (const chunk of stream) {
          yield chunk.choices[0]?.delta?.content ?? '';
        }
      })();
    },
    async chatComplete(
      messages: ChatMessage[],
      tools?: AiToolDefinition[],
    ): Promise<ChatCompletionResult> {
      const response = await opencode.chat.completions.create({
        messages: toOpenAiMessages(messages),
        model: OPENCODE_MODEL,
        temperature: 0.6,
        max_completion_tokens: 4096,
        tools: tools?.length ? toolsToOpenAiFormat(tools) : undefined,
        tool_choice: tools?.length ? 'auto' : undefined,
      });

      const choice = response.choices[0]?.message;
      const toolCalls: ToolCallRequest[] = (choice?.tool_calls ?? [])
        .filter((toolCall) => toolCall.type === 'function')
        .map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: parseToolCallArguments(toolCall.function.arguments),
        }));

      return {
        content: choice?.content ?? '',
        toolCalls,
      };
    },
    async chatCompleteStream(messages, tools, onToken) {
      return streamOpenAiChatComplete(
        (params) =>
          opencode.chat.completions.create({
            ...params,
            model: OPENCODE_MODEL,
          }),
        messages,
        tools,
        onToken,
        {
          model: OPENCODE_MODEL,
          temperature: 0.6,
          max_completion_tokens: 4096,
          top_p: 1,
        },
      );
    },
  };
}
