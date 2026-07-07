import type { AiActionSummary } from './ai.types';
import {
  enrichMessageMetadata,
  isInternalToolRequestMessage,
} from './enrich-session-messages';

describe('enrich-session-messages', () => {
  const action: AiActionSummary = {
    id: 'action-1',
    actionType: 'update_theme',
    targetModule: 'core',
    payload: { theme: 'dark' },
    status: 'SUCCESS',
    label: 'Cambiar tema',
  };

  it('detects internal tool request assistant messages', () => {
    expect(
      isInternalToolRequestMessage({
        role: 'assistant',
        content: '[tool_calls]',
        metadata: { phase: 'tool_request' },
      }),
    ).toBe(true);
  });

  it('keeps regular assistant messages visible', () => {
    expect(
      isInternalToolRequestMessage({
        role: 'assistant',
        content: 'He preparado los cambios.',
        metadata: {},
      }),
    ).toBe(false);
  });

  it('enriches stored action snapshots with live status', () => {
    const actionsById = new Map([[action.id, action]]);
    const metadata = enrichMessageMetadata(
      {
        actions: [{ ...action, status: 'PENDING' }],
        blocks: [{ type: 'action', action: { ...action, status: 'PENDING' } }],
      },
      actionsById,
    );

    expect(metadata.actions).toEqual([action]);
    expect(metadata.blocks).toEqual([{ type: 'action', action }]);
  });
});
