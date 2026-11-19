import { aiInvocationContextKey } from './ai-invocation-context-key';

describe('aiInvocationContextKey', () => {
  it('ignora el orden de claves de objetos, pero mantiene las diferencias de contexto', () => {
    const first = aiInvocationContextKey({
      route: '/finance',
      filters: { month: '2026-11', status: 'open' },
    });
    const reordered = aiInvocationContextKey({
      filters: { status: 'open', month: '2026-11' },
      route: '/finance',
    });
    const otherRoute = aiInvocationContextKey({
      route: '/finance/accounts',
      filters: { month: '2026-11', status: 'open' },
    });
    expect(first).toBe(reordered);
    expect(first).not.toBe(otherRoute);
  });
});
