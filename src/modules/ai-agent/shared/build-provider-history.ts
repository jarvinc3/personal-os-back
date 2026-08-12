import type { ChatMessage, ToolCallRequest } from './ai.types';
import { isInternalToolRequestMessage } from './enrich-session-messages';

type StoredMessage = {
  role: string;
  content: string;
  toolCalls: unknown;
  metadata: unknown;
};

function parseStoredToolCalls(value: unknown): ToolCallRequest[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const parsed = value
    .filter(
      (item): item is ToolCallRequest =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as ToolCallRequest).id === 'string' &&
        typeof (item as ToolCallRequest).name === 'string',
    )
    .map((item) => ({
      id: item.id,
      name: item.name,
      arguments:
        item.arguments && typeof item.arguments === 'object'
          ? item.arguments
          : {},
    }));

  return parsed.length > 0 ? parsed : undefined;
}

export function buildProviderHistoryFromStored(
  stored: StoredMessage[],
): ChatMessage[] {
  const chronological = [...stored].reverse();
  const history: ChatMessage[] = [];

  for (const message of chronological) {
    if (message.role === 'user') {
      history.push({ role: 'user', content: message.content });
      continue;
    }

    if (message.role === 'assistant') {
      if (
        isInternalToolRequestMessage({
          role: message.role,
          content: message.content,
          metadata: message.metadata,
        })
      ) {
        continue;
      }

      const toolCalls = parseStoredToolCalls(message.toolCalls);
      if (toolCalls?.length) {
        continue;
      }

      if (message.content.trim().length === 0) {
        continue;
      }

      history.push({ role: 'assistant', content: message.content });
      continue;
    }

    // Tool outputs are only needed during an active tool loop, not in replayed history.
    if (message.role === 'tool') {
      continue;
    }
  }

  return history;
}
