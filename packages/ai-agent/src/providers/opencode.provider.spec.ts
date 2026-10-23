import { Readable } from 'node:stream';
import OpenAI from 'openai';
import type { AiToolDefinition, ChatMessage } from '../shared/ai.types';
import { mapMessagesToOpenAi } from '../shared/map-messages-to-openai';
import { toolsToOpenAiFormat } from '../tools/tool.registry';
import { createOpenCodeProvider } from './opencode.provider';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    chat: { completions: { create: jest.fn() } },
  })),
}));

const OPENCODE_ENDPOINT = 'https://opencode.ai/inference/openai/v1';
const OPENCODE_MODEL = 'deepseek-v4.1-flash-free';

const MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'Eres un asistente.' },
  { role: 'user', content: '¿Cuánto gasté?' },
];

const TOOLS: AiToolDefinition[] = [
  {
    name: 'list_accounts',
    description: 'Lista las cuentas del usuario.',
    parameters: { type: 'object', properties: {} },
    mutating: false,
    targetModule: 'finance',
  },
];

function toStream(chunks: unknown[]): AsyncIterable<Record<string, unknown>> {
  return Readable.from(chunks) as AsyncIterable<Record<string, unknown>>;
}

function completionsCreateMock(): jest.Mock {
  const client = (OpenAI as unknown as jest.Mock).mock.results.at(-1)
    ?.value as {
    chat: { completions: { create: jest.Mock } };
  };
  return client.chat.completions.create;
}

describe('createOpenCodeProvider', () => {
  beforeEach(() => {
    (OpenAI as unknown as jest.Mock).mockClear();
  });

  it('targets the OpenAI-compatible OpenCode endpoint with the free model', () => {
    const provider = createOpenCodeProvider('test-key');

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: 'test-key',
      baseURL: OPENCODE_ENDPOINT,
    });
    expect(provider.name).toBe('OpenCode');
    expect(provider.model).toBe(OPENCODE_MODEL);
  });

  it('maps messages and returns the function tool calls', async () => {
    const provider = createOpenCodeProvider('test-key');
    const create = completionsCreateMock();
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Voy a consultar tus cuentas.',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'list_accounts', arguments: '{"limit":5}' },
              },
              {
                id: 'call_2',
                type: 'custom',
                custom: { name: 'raw_tool', input: '{}' },
              },
            ],
          },
        },
      ],
    });

    const completion = await provider.chatComplete!(MESSAGES, TOOLS);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: OPENCODE_MODEL,
        messages: mapMessagesToOpenAi(MESSAGES),
        tools: toolsToOpenAiFormat(TOOLS),
        tool_choice: 'auto',
      }),
    );
    expect(completion).toEqual({
      content: 'Voy a consultar tus cuentas.',
      toolCalls: [
        { id: 'call_1', name: 'list_accounts', arguments: { limit: 5 } },
      ],
    });
  });

  it('omits tools and tool choice when the call carries none', async () => {
    const provider = createOpenCodeProvider('test-key');
    const create = completionsCreateMock();
    create.mockResolvedValue({
      choices: [{ message: { content: 'Sin herramientas.' } }],
    });

    const completion = await provider.chatComplete!(MESSAGES);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: undefined,
        tool_choice: undefined,
      }),
    );
    expect(completion).toEqual({ content: 'Sin herramientas.', toolCalls: [] });
  });

  it('streams the chat deltas', async () => {
    const provider = createOpenCodeProvider('test-key');
    const create = completionsCreateMock();
    create.mockResolvedValue(
      toStream([
        { choices: [{ delta: { content: 'Hola ' } }] },
        { choices: [{ delta: { content: 'mundo' } }] },
        { choices: [] },
      ]),
    );

    const stream = await provider.chat(MESSAGES);
    const parts: string[] = [];
    for await (const part of stream) {
      parts.push(part);
    }

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: OPENCODE_MODEL, stream: true }),
    );
    expect(parts.join('')).toBe('Hola mundo');
  });

  it('aggregates streamed tool calls and forwards the tokens', async () => {
    const provider = createOpenCodeProvider('test-key');
    const create = completionsCreateMock();
    create.mockResolvedValue(
      toStream([
        { choices: [{ delta: { content: 'Consulto ' } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    function: { name: 'list_accounts', arguments: '{"lim' },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: 'it":5}' } }],
              },
            },
          ],
        },
      ]),
    );
    const tokens: string[] = [];

    const streamedCompletion = await provider.chatCompleteStream!(
      MESSAGES,
      TOOLS,
      (delta) => tokens.push(delta),
    );

    expect(tokens).toEqual(['Consulto ']);
    expect(streamedCompletion).toEqual({
      content: 'Consulto ',
      toolCalls: [
        { id: 'call_1', name: 'list_accounts', arguments: { limit: 5 } },
      ],
    });
  });
});
