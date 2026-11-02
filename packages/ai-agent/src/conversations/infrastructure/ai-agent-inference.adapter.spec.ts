import { AiAgentInferenceAdapter } from './ai-agent-inference.adapter';

describe('AiAgentInferenceAdapter', () => {
  it('uses the existing provider gateway and maps registered capabilities to tools', async () => {
    const inference = {
      chatComplete: jest.fn().mockResolvedValue({
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            name: 'finance_monthly_summary',
            arguments: { month: '2026-11' },
          },
        ],
        provider: 'Groq',
        model: 'model-1',
      }),
    };
    const adapter = new AiAgentInferenceAdapter(inference as never);
    const messages = [{ role: 'user' as const, content: 'Gastos del mes' }];
    const tools = [
      {
        name: 'finance_monthly_summary',
        description: 'Monthly spending',
        parameters: { type: 'object' },
        moduleSlug: 'finance',
        effect: 'READ' as const,
      },
      {
        name: 'finance.update_budget',
        description: 'Update budget',
        parameters: { type: 'object' },
        moduleSlug: 'finance',
        effect: 'WRITE' as const,
        actionPolicy: 'CONFIRM_REQUIRED' as const,
      },
    ];

    await expect(adapter.complete(messages, tools)).resolves.toMatchObject({
      content: '',
      provider: 'Groq',
      toolCalls: [
        {
          id: 'call-1',
          name: 'finance_monthly_summary',
          arguments: { month: '2026-11' },
        },
      ],
    });
    expect(inference.chatComplete).toHaveBeenCalledWith(messages, undefined, [
      {
        name: 'finance_monthly_summary',
        description: 'Monthly spending',
        parameters: { type: 'object' },
        mutating: false,
        targetModule: 'finance',
      },
      {
        name: 'finance.update_budget',
        description: 'Update budget',
        parameters: { type: 'object' },
        mutating: true,
        targetModule: 'finance',
      },
    ]);
  });
});
