import { TONE_INSTRUCTIONS, buildSystemPrompt } from './build-system-prompt';

describe('buildSystemPrompt', () => {
  it('responds in Spanish when no locale is set', () => {
    const prompt = buildSystemPrompt({ tone: 'balanced' });

    expect(prompt).toContain('Responde en español');
  });

  it('keeps the Spanish hint for Spanish locales', () => {
    const prompt = buildSystemPrompt({ tone: 'balanced', locale: 'ES-do' });

    expect(prompt).toContain('Responde en español');
  });

  it('asks for the user language outside Spanish locales', () => {
    const prompt = buildSystemPrompt({ tone: 'balanced', locale: 'en-US' });

    expect(prompt).toContain('Respond in the user language.');
  });

  it.each(Object.entries(TONE_INSTRUCTIONS))(
    'includes the %s tone instruction',
    (tone, instruction) => {
      const prompt = buildSystemPrompt({ tone: tone as never });

      expect(prompt).toContain(instruction);
    },
  );

  it('omits the confirmation hint by default', () => {
    const prompt = buildSystemPrompt({ tone: 'concise' });

    expect(prompt).not.toContain('espera confirmación explícita');
  });

  it('includes the confirmation hint when the user asks for it', () => {
    const prompt = buildSystemPrompt({
      tone: 'concise',
      confirmBeforeActions: true,
    });

    expect(prompt).toContain('espera confirmación explícita');
  });
});
