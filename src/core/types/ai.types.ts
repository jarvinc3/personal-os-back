export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIService {
  name: string;
  model: string;
  chat: (messages: ChatMessage[]) => Promise<AsyncIterable<string>>;
}

export interface AIProviderInfo {
  name: string;
  model: string;
}
