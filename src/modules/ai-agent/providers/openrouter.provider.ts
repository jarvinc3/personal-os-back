import { OpenRouter } from '@openrouter/sdk';
import type { AIService, ChatMessage } from '../../../core/types/ai.types';

const OPENROUTER_MODEL = 'deepseek/deepseek-v4-flash';

export function createOpenRouterProvider(apiKey: string): AIService {
  const openrouter = new OpenRouter({ apiKey });

  return {
    name: 'OpenRouter',
    model: OPENROUTER_MODEL,
    async chat(messages: ChatMessage[]) {
      const stream = await openrouter.chat.send({
        chatRequest: {
          model: OPENROUTER_MODEL,
          messages,
          stream: true,
        },
      });

      return (async function* () {
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            yield content;
          }
        }
      })();
    },
  };
}
