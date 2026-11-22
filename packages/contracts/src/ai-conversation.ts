import type { JsonObject } from './primitives';

export const AI_CONVERSATION_INFERENCE = Symbol.for(
  'personal-os.contracts.ai-conversation-inference',
);

export type AiToolCall = {
  id: string;
  name: string;
  arguments: JsonObject;
};

export interface AiConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: readonly AiToolCall[];
}

export interface AiToolSpec {
  name: string;
  description: string;
  parameters: JsonObject;
  moduleSlug: string;
  effect: 'READ' | 'WRITE';
  actionPolicy?: AiActionPolicy;
}

export type AiActionPolicy = 'AUTO_ALLOWED' | 'CONFIRM_REQUIRED' | 'FORBIDDEN';

export const AI_ACTION_POLICY_VERSION = 'ai-10-v1';

export interface AiConversationCompletion {
  content: string;
  toolCalls: readonly AiToolCall[];
  provider: string;
  model: string;
}

export interface AiConversationStreamRequest {
  messages: readonly AiConversationMessage[];
  tools?: readonly AiToolSpec[];
  signal?: AbortSignal;
  onContent: (chunk: string) => void;
  /** El proveedor anterior falló después de emitir texto; limpia lo mostrado. */
  onReset?: () => void;
}

export interface AiConversationInferencePort {
  complete(
    messages: readonly AiConversationMessage[],
    tools?: readonly AiToolSpec[],
  ): Promise<AiConversationCompletion>;
  stream?(
    request: AiConversationStreamRequest,
  ): Promise<AiConversationCompletion>;
  summarize(messages: readonly AiConversationMessage[]): Promise<string>;
}
