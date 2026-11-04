import { mapMessagesToOpenAi } from './map-messages-to-openai';
import type { ChatMessage } from './ai.types';

describe('mapMessagesToOpenAi', () => {
  it('maps assistant tool_calls for follow-up provider requests', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Cambia el tema a light' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'set_theme', arguments: { value: 'light' } },
        ],
      },
      {
        role: 'tool',
        content: '{"success":true}',
        toolCallId: 'call_1',
        name: 'set_theme',
      },
    ];

    expect(mapMessagesToOpenAi(messages)).toEqual([
      { role: 'user', content: 'Cambia el tema a light' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'set_theme',
              arguments: '{"value":"light"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        content: '{"success":true}',
        tool_call_id: 'call_1',
        name: 'set_theme',
      },
    ]);
  });
});
