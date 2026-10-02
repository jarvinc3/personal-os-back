export const AI_CHAT_COMPLETION = 'AI_CHAT_COMPLETION' as const;

export interface AiChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

export type AiChatCompletionResult = {
  content: string;
  provider: string;
  model: string;
};

export interface AiChatCompletionPort {
  chatComplete(messages: AiChatMessage[]): Promise<AiChatCompletionResult>;
}
