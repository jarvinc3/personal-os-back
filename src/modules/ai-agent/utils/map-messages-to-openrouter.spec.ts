import { mapMessagesToOpenRouter } from './map-messages-to-openrouter';
import type { ChatMessage } from './ai.types';

describe('mapMessagesToOpenRouter', () => {
  it('maps tool and assistant toolCalls using OpenRouter SDK field names', () => {
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
      },
    ];

    expect(mapMessagesToOpenRouter(messages)).toEqual([
      { role: 'user', content: 'Cambia el tema a light' },
      {
        role: 'assistant',
        content: null,
        toolCalls: [
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
        toolCallId: 'call_1',
      },
    ]);
  });

  it('drops tool messages without toolCallId', () => {
    expect(
      mapMessagesToOpenRouter([
        { role: 'user', content: 'hola' },
        { role: 'tool', content: 'orphan' },
      ]),
    ).toEqual([{ role: 'user', content: 'hola' }]);
  });
});
