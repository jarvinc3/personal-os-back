import { AiActionSummary, ChatBlock } from './ai.types';

const INTERNAL_TOOL_REQUEST_CONTENT = '[tool_calls]';

export function isInternalToolRequestMessage(message: {
  role: string;
  content: string;
  metadata: unknown;
}): boolean {
  if (message.role !== 'assistant') {
    return false;
  }

  const metadata = (message.metadata ?? {}) as Record<string, unknown>;
  return (
    metadata.phase === 'tool_request' ||
    message.content.trim() === INTERNAL_TOOL_REQUEST_CONTENT
  );
}

export function enrichMessageMetadata(
  metadata: Record<string, unknown>,
  actionsById: Map<string, AiActionSummary>,
): Record<string, unknown> {
  const actions = metadata.actions as AiActionSummary[] | undefined;
  const blocks = metadata.blocks as ChatBlock[] | undefined;

  const enrichedActions = actions?.map(
    (action) => actionsById.get(action.id) ?? action,
  );
  const enrichedBlocks = blocks?.map((block) => {
    if (block.type !== 'action') {
      return block;
    }

    const liveAction = actionsById.get(block.action.id);
    return liveAction ? { type: 'action' as const, action: liveAction } : block;
  });

  return {
    ...metadata,
    ...(enrichedActions ? { actions: enrichedActions } : {}),
    ...(enrichedBlocks ? { blocks: enrichedBlocks } : {}),
  };
}
