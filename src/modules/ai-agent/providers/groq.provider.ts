import { Groq } from 'groq-sdk';
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
import { streamOpenAiChatComplete } from '../utils/stream-openai-chat-complete';

const GROQ_MODEL = 'llama-3.3-70b-versatile';

export function createGroqProvider(apiKey: string): AIService {
  const groq = new Groq({ apiKey });

  return {
    name: 'Groq',
    model: GROQ_MODEL,
    async chat(messages: ChatMessage[]) {
      const stream = await groq.chat.completions.create({
        messages: mapMessagesToOpenAi(messages),
        model: GROQ_MODEL,
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
      const response = await groq.chat.completions.create({
        messages: mapMessagesToOpenAi(messages),
        model: GROQ_MODEL,
        temperature: 0.6,
        max_completion_tokens: 4096,
        tools: tools?.length ? toolsToOpenAiFormat(tools) : undefined,
        tool_choice: tools?.length ? 'auto' : undefined,
      });

      const choice = response.choices[0]?.message;
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
    async chatCompleteStream(messages, tools, onToken) {
      return streamOpenAiChatComplete(
        (params) =>
          groq.chat.completions.create({
            ...params,
            model: GROQ_MODEL,
          }),
        messages,
        tools,
        onToken,
        {
          model: GROQ_MODEL,
          temperature: 0.6,
          max_completion_tokens: 4096,
          top_p: 1,
        },
      );
    },
  };
}
