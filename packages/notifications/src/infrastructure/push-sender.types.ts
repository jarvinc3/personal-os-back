export type PushTokenEntry = {
  token: string;
  platform: string;
};

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type PushSendResult = {
  sent: number;
  failed: number;
  deactivatedTokens: string[];
};
