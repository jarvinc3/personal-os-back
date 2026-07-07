export async function replayStreamChunks(
  content: string,
  onChunk: (chunk: string) => void,
  options?: { chunkSize?: number; delayMs?: number },
): Promise<void> {
  const chunkSize = options?.chunkSize ?? 24;
  const delayMs = options?.delayMs ?? 0;

  for (let i = 0; i < content.length; i += chunkSize) {
    onChunk(content.slice(i, i + chunkSize));
    if (delayMs > 0 && i + chunkSize < content.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
