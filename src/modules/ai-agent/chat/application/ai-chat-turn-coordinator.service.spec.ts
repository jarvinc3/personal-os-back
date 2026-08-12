import { AiChatTurnCoordinator } from './ai-chat-turn-coordinator.service';
import type { AgentRunResult } from './utils/ai.types';

describe('AiChatTurnCoordinator', () => {
  const coordinator = new AiChatTurnCoordinator();

  const baseResult: AgentRunResult = {
    sessionId: 'session-1',
    provider: 'groq',
    model: 'test-model',
    content: 'Hola mundo',
    moduleSlug: 'general',
    moduleLabel: 'General',
  };

  it('deduplicates concurrent runs for the same turn', async () => {
    let runs = 0;
    const execute = jest.fn(async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return baseResult;
    });

    const [first, second] = await Promise.all([
      coordinator.run(
        { sessionId: 'session-1', clientMessageId: 'turn-1' },
        execute,
      ),
      coordinator.run(
        { sessionId: 'session-1', clientMessageId: 'turn-1' },
        execute,
      ),
    ]);

    expect(runs).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(first.content).toBe('Hola mundo');
    expect(second.content).toBe('Hola mundo');
  });

  it('replays chunks for joined in-flight requests', async () => {
    const events: string[] = [];

    const [first, second] = await Promise.all([
      coordinator.run(
        { sessionId: 'session-1', clientMessageId: 'turn-2' },
        async (onStream) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          onStream?.({ type: 'chunk', content: 'live' });
          return baseResult;
        },
        (event) => {
          if (event.type === 'chunk') {
            events.push(`first:${event.content}`);
          }
        },
      ),
      coordinator.run(
        { sessionId: 'session-1', clientMessageId: 'turn-2' },
        () => Promise.resolve(baseResult),
        (event) => {
          if (event.type === 'chunk') {
            events.push(`second:${event.content}`);
          }
        },
      ),
    ]);

    expect(first.content).toBe('Hola mundo');
    expect(second.content).toBe('Hola mundo');
    expect(events.some((entry) => entry.startsWith('first:live'))).toBe(true);
    expect(events.some((entry) => entry.startsWith('second:'))).toBe(true);
  });
});
