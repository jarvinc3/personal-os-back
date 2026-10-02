import type { ChatMessage } from './ai.types';

export function mapMessagesToOpenAi(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.role !== 'tool' || Boolean(message.toolCallId))
    .map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'tool' as const,
          content: message.content,
          tool_call_id: message.toolCallId!,
          ...(message.name ? { name: message.name } : {}),
        };
      }

      if (message.role === 'assistant' && message.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: message.content || null,
          tool_calls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function' as const,
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments ?? {}),
            },
          })),
        };
      }

      return {
        role: message.role,
        content: message.content,
      };
    });
}
