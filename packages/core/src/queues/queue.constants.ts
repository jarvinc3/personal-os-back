export const QueueNames = {
  EMAIL_SYNC: 'email-sync',
  NOTIFICATIONS: 'notifications',
  STATEMENT_IMPORT: 'statement-import',
} as const;
export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];
