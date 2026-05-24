export type SideEffectDescriptor =
  | { type: 'invalidate'; keys: string[] }
  | { type: 'theme'; value: 'system' | 'light' | 'dark' };

export type AiActionSummary = {
  id: string;
  actionType: string;
  targetModule: string;
  payload: Record<string, unknown>;
  status: string;
  label?: string;
};

export type ChatBlock =
  | { type: 'markdown'; content: string }
  | { type: 'action'; action: AiActionSummary };

export type AgentRunResult = {
  sessionId: string;
  provider: string;
  model: string;
  content: string;
  requiresConfirmation?: boolean;
  actions?: AiActionSummary[];
  sideEffects?: SideEffectDescriptor[];
  blocks?: ChatBlock[];
};

export type ToolCallRequest = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatCompletionResult = {
  content: string;
  toolCalls: ToolCallRequest[];
};

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  mutating: boolean;
  targetModule: string;
}

export interface ToolContext {
  userId: string;
  sessionId: string;
  moduleSlug: string | null;
  confirmBeforeActions: boolean;
}

export interface ToolExecutionResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
  sideEffects?: SideEffectDescriptor[];
}

export interface AIService {
  name: string;
  model: string;
  chat: (
    messages: ChatMessage[],
    tools?: AiToolDefinition[],
  ) => Promise<AsyncIterable<string> & { getToolCalls?: () => ToolCallRequest[] }>;
  chatComplete?: (
    messages: ChatMessage[],
    tools?: AiToolDefinition[],
  ) => Promise<ChatCompletionResult>;
}

export interface AIProviderInfo {
  name: string;
  model: string;
}

export type AiResponseWsPayload = {
  type: 'chat.complete' | 'chat.chunk' | 'insight' | 'action.updated';
  sessionId?: string;
  provider?: string;
  model?: string;
  content?: string;
  stream?: boolean;
  actions?: AiActionSummary[];
  sideEffects?: SideEffectDescriptor[];
  actionType?: string;
  source?: string;
  requiresConfirmation?: boolean;
};
