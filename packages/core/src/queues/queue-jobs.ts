export type NotificationDispatchJob = {
  notificationId: string;
  userId: string;
  channel: 'IN_APP' | 'PUSH' | 'EMAIL';
  title: string;
  body: string;
  data?: Record<string, unknown>;
};
export type EmailSyncJob = {
  userId: string;
  template: string;
  to: string;
  subject: string;
  body: string;
  data?: Record<string, unknown>;
};
export type StatementImportJob = {
  userId: string;
  importId: string;
  password?: string;
};
