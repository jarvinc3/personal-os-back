import type { InferenceMessage } from '@personal-os/contracts';

export type ToolCallRequest = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatCompletionResult = {
  content: string;
  toolCalls: ToolCallRequest[];
  usage?: { inputTokens?: number; outputTokens?: number };
};

export interface ChatMessage extends InferenceMessage {
  toolCallId?: string;
  name?: string;
  toolCalls?: ToolCallRequest[];
}

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  mutating: boolean;
  targetModule: string;
}

export type ChatStreamInput = {
  messages: ChatMessage[];
  tools?: AiToolDefinition[];
  signal?: AbortSignal;
  onContent: (chunk: string) => void;
};

export interface AIService {
  name: string;
  model: string;
  chatComplete?: (
    messages: ChatMessage[],
    tools?: AiToolDefinition[],
  ) => Promise<ChatCompletionResult>;
  chatStream?: (input: ChatStreamInput) => Promise<ChatCompletionResult>;
}
