import { Groq } from 'groq-sdk';
import type {
  AiToolDefinition,
  AIService,
  ChatCompletionResult,
  ChatMessage,
  ToolCallRequest,
} from '../utils/ai.types';
import { parseToolCallArguments, toolsToOpenAiFormat } from '../tools/tool.registry';

const GROQ_MODEL = 'openai/gpt-oss-safeguard-20b';

function mapMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool' as const,
        content: m.content,
        tool_call_id: m.toolCallId ?? '',
      };
    }
    return { role: m.role as 'user' | 'assistant' | 'system', content: m.content };
  });
}

export function createGroqProvider(apiKey: string): AIService {
  const groq = new Groq({ apiKey });

  return {
    name: 'Groq',
    model: GROQ_MODEL,
    async chat(messages: ChatMessage[]) {
      const stream = await groq.chat.completions.create({
        messages: mapMessages(messages),
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
        messages: mapMessages(messages),
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
  };
}
