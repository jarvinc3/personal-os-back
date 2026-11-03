import { AiSignalConsumerRegistry } from './ai-signal-consumer.registry';

describe('AiSignalConsumerRegistry', () => {
  it('resolves a registered consumer by domain', () => {
    const registry = new AiSignalConsumerRegistry();
    const consumer = { domain: 'FINANCE', consume: jest.fn() };
    registry.register(consumer);
    expect(registry.get('FINANCE')).toBe(consumer);
  });

  it('rejects replacing a domain consumer', () => {
    const registry = new AiSignalConsumerRegistry();
    registry.register({ domain: 'FINANCE', consume: jest.fn() });
    expect(() =>
      registry.register({ domain: 'FINANCE', consume: jest.fn() }),
    ).toThrow('AI signal consumer already registered for FINANCE');
  });
});
