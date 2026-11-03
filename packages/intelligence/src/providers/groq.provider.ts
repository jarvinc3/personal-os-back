import { Groq } from 'groq-sdk';
import {
  parseToolCallArguments,
  toolsToOpenAiFormat,
} from '../shared/provider-tool-codec';
import type {
  AIService,
  AiToolDefinition,
  ChatCompletionResult,
  ChatMessage,
  ToolCallRequest,
} from '../shared/ai.types';
import { mapMessagesToOpenAi } from '../shared/map-messages-to-openai';

const GROQ_MODEL = 'qwen/qwen3.8-27b';

export function createGroqProvider(apiKey: string): AIService {
  const groq = new Groq({ apiKey });

  return {
    name: 'Groq',
    model: GROQ_MODEL,
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
        usage: response.usage
          ? {
              inputTokens: response.usage.prompt_tokens,
              outputTokens: response.usage.completion_tokens,
            }
          : undefined,
      };
    },
  };
}
