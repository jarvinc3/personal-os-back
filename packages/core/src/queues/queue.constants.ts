export const QueueNames = {
  EMAIL_SYNC: 'email-sync',
  GMAIL_SYNC: 'gmail-sync',
  AI_PROCESSING: 'ai-processing',
  NOTIFICATIONS: 'notifications',
  STATEMENT_IMPORT: 'statement-import',
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];
