jest.mock('@openrouter/sdk', () => {
  const send = jest.fn();
  function OpenRouter() {
    return { chat: { send } };
  }
  return { OpenRouter, __send: send };
});

import { createOpenRouterProvider } from './openrouter.provider';

const sdk = jest.requireMock<{ __send: jest.Mock }>('@openrouter/sdk');

describe('OpenRouter provider', () => {
  beforeEach(() => {
    sdk.__send.mockReset();
  });

  it('bounds the output budget so a low balance can pay for the call', async () => {
    sdk.__send.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Hola',
            toolCalls: [
              {
                id: 'call-1',
                function: { name: 'buscar', arguments: '{"q":1}' },
              },
            ],
          },
        },
      ],
      usage: { promptTokens: 9, completionTokens: 2 },
    });
    const provider = createOpenRouterProvider('test-key');

    const completion = await provider.chatComplete!([
      { role: 'user', content: 'Hola' },
    ]);

    expect(sdk.__send).toHaveBeenCalledWith({
      chatRequest: expect.objectContaining({
        model: 'deepseek/deepseek-v4-flash',
        maxTokens: 4096,
        stream: false,
      }),
    });
    expect(completion).toEqual({
      content: 'Hola',
      toolCalls: [{ id: 'call-1', name: 'buscar', arguments: { q: 1 } }],
      usage: { inputTokens: 9, outputTokens: 2 },
    });
  });
});
