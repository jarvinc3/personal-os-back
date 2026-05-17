import Cerebras from '@cerebras/cerebras_cloud_sdk';
import type { AIService, ChatMessage } from '../utils/ai.types';

const CEREBRAS_MODEL = 'llama3.1-8b';

export function createCerebrasProvider(apiKey: string): AIService {
  const cerebras = new Cerebras({ apiKey });

  return {
    name: 'Cerebras',
    model: CEREBRAS_MODEL,
    async chat(messages: ChatMessage[]) {
      const stream = await cerebras.chat.completions.create({
        messages: messages as Parameters<
          typeof cerebras.chat.completions.create
        >[0]['messages'],
        model: CEREBRAS_MODEL,
        stream: true,
        max_completion_tokens: 8192,
        temperature: 0.6,
        top_p: 0.95,
      });

      return (async function* () {
        for await (const chunk of stream as AsyncIterable<{
          choices: Array<{ delta?: { content?: string | null } }>;
        }>) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            yield content;
          }
        }
      })();
    },
  };
}
