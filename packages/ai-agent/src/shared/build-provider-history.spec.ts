import { buildProviderHistoryFromStored } from './build-provider-history';

describe('buildProviderHistoryFromStored', () => {
  it('keeps user and final assistant messages only', () => {
    // Stored order is newest-first, as returned by findRecentMessages.
    const history = buildProviderHistoryFromStored([
      {
        role: 'user',
        content: 'Gracias',
        toolCalls: null,
        metadata: { clientMessageId: 'turn-2' },
      },
      {
        role: 'assistant',
        content: 'Listo, cambié el tema a oscuro.',
        toolCalls: null,
        metadata: { provider: 'opencode', model: 'deepseek-v4.1-flash-free' },
      },
      {
        role: 'tool',
        content: '{"success":true}',
        toolCalls: null,
        metadata: { tool: 'update_theme', toolCallId: 'call_1' },
      },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'update_theme', arguments: {} }],
        metadata: { phase: 'tool_request' },
      },
      {
        role: 'user',
        content: 'Cambia el tema a oscuro',
        toolCalls: null,
        metadata: {},
      },
    ]);

    expect(history).toEqual([
      { role: 'user', content: 'Cambia el tema a oscuro' },
      { role: 'assistant', content: 'Listo, cambié el tema a oscuro.' },
      { role: 'user', content: 'Gracias' },
    ]);
  });

  it('drops orphaned tool_request rows without tool responses', () => {
    const history = buildProviderHistoryFromStored([
      {
        role: 'assistant',
        content: 'Ejecutando herramienta…',
        toolCalls: [{ id: '8b4286948', name: 'get_profile', arguments: {} }],
        metadata: { phase: 'tool_request' },
      },
      {
        role: 'user',
        content: 'Hola',
        toolCalls: null,
        metadata: {},
      },
    ]);

    expect(history).toEqual([{ role: 'user', content: 'Hola' }]);
  });
});
