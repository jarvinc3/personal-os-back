import { Groq } from 'groq-sdk';
import type { AIService, ChatMessage } from '../../../core/types/ai.types';

const GROQ_MODEL = 'openai/gpt-oss-safeguard-20b';

export function createGroqProvider(apiKey: string): AIService {
  const groq = new Groq({ apiKey });

  return {
    name: 'Groq',
    model: GROQ_MODEL,
    async chat(messages: ChatMessage[]) {
      const stream = await groq.chat.completions.create({
        messages,
        model: GROQ_MODEL,
        temperature: 0.6,
        max_completion_tokens: 4096,
        top_p: 1,
        stream: true,
      });

      return (async function* () {
        for await (const chunk of stream) {
          yield chunk.choices[0]?.delta?.content ?? '';
        }
      })();
    },
  };
}
