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

  it('ordena claves sin depender del locale del runtime', () => {
    const localeCompare = jest
      .spyOn(String.prototype, 'localeCompare')
      .mockImplementation(() => {
        throw new Error('No debe consultar el locale del runtime');
      });
    try {
      expect(
        aiInvocationContextKey({
          route: '/finance',
          filters: { ä: 'uno', z: 'dos' },
        }),
      ).toBe(
        aiInvocationContextKey({
          filters: { z: 'dos', ä: 'uno' },
          route: '/finance',
        }),
      );
      expect(localeCompare).not.toHaveBeenCalled();
    } finally {
      localeCompare.mockRestore();
    }
  });
});
