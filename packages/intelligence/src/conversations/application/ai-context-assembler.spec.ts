import type {
  AiCapabilityDescriptor,
  AiCapabilityRegistryPort,
} from '@personal-os/contracts';
import { AiContextAssembler } from './ai-context-assembler';

describe('AiContextAssembler', () => {
  const descriptor: AiCapabilityDescriptor = {
    id: 'finance_monthly_summary',
    moduleSlug: 'finance',
    version: 1,
    description: 'Monthly finance summary',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    effect: 'READ',
  };

  it('supplies private conversation summary and reports unavailable modules safely', async () => {
    const registry: Pick<AiCapabilityRegistryPort, 'readContext'> = {
      readContext: jest
        .fn()
        .mockRejectedValue(new Error('private provider detail')),
    };
    const assembler = new AiContextAssembler(
      registry as AiCapabilityRegistryPort,
    );

    const messages = await assembler.assemble({
      ctx: {
        userId: 'user-1',
        invocationId: 'invocation-1',
        correlationId: 'conversation-1',
      },
      descriptors: [descriptor],
      history: [{ role: 'user', content: '¿Cuánto gasté?' }],
      summary: 'El usuario prefiere cifras mensuales.',
    });

    expect(messages[0].content).toContain('available');
    expect(messages[0].content).toContain('false');
    expect(messages[0].content).toContain('Resumen privado');
    expect(messages[0].content).not.toContain('private provider detail');
    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: '¿Cuánto gasté?',
    });
  });
});
