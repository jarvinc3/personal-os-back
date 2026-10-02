import { replayStreamChunks } from './replay-stream-chunks';

describe('replayStreamChunks', () => {
  it('emits content in configured chunk sizes', async () => {
    const chunks: string[] = [];
    await replayStreamChunks(
      'hello world',
      (chunk) => {
        chunks.push(chunk);
      },
      { chunkSize: 5, delayMs: 0 },
    );

    expect(chunks.join('')).toBe('hello world');
    expect(chunks.length).toBeGreaterThan(1);
  });
});
