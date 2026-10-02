import type { ChatMessage } from './ai.types';

export function mapMessagesToOpenRouter(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.role !== 'tool' || Boolean(message.toolCallId))
    .map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'tool' as const,
          content: message.content,
          toolCallId: message.toolCallId!,
        };
      }

      if (message.role === 'assistant' && message.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: message.content || null,
          toolCalls: message.toolCalls.map((toolCall) => ({
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
