export const QueueNames = {
  EMAIL_SYNC: 'email-sync',
  NOTIFICATIONS: 'notifications',
  STATEMENT_IMPORT: 'statement-import',
  AI_SIGNAL_ROUTING: 'ai-signal-routing',
  AI_EMAIL_SAMPLE_IMPORT: 'ai-email-sample-import',
} as const;
export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];
