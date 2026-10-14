import { buildAgentPrompt } from './build-agent-prompt';

describe('buildAgentPrompt', () => {
  it('describes the entity in focus with its id', () => {
    const prompt = buildAgentPrompt({
      tone: 'balanced',
      moduleSlug: 'finance',
      entityContext: {
        type: 'loan',
        id: 'loan-1',
        name: 'BHD',
        summary: 'saldo 50000.00 DOP',
      },
    });

    expect(prompt).toContain('Entidad en foco: loan "BHD" (id: loan-1)');
    expect(prompt).toContain('Datos: saldo 50000.00 DOP');
  });

  it('bounds the entity name and summary', () => {
    const prompt = buildAgentPrompt({
      tone: 'balanced',
      entityContext: {
        type: 'transaction',
        id: 'tx-1',
        name: 'x'.repeat(1000),
        summary: 'y'.repeat(5000),
      },
    });

    expect(prompt).not.toContain('x'.repeat(161));
    expect(prompt).not.toContain('y'.repeat(601));
  });

  it('omits the entity hint without a context', () => {
    const prompt = buildAgentPrompt({ tone: 'balanced' });

    expect(prompt).not.toContain('Entidad en foco');
  });
});
