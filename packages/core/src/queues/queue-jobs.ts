export type NotificationDispatchJob = {
  notificationId: string;
  userId: string;
  channel: 'IN_APP' | 'PUSH' | 'EMAIL';
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type AiProcessingJob = {
  userId: string;
  actionType: string;
  payload: Record<string, unknown>;
};

export type EmailSyncJob = {
  userId: string;
  template: string;
  to: string;
  subject: string;
  body: string;
  data?: Record<string, unknown>;
};

export type GmailSyncJob = {
  userId: string;
  sourceId: string;
  forceFullSync?: boolean;
};

export type StatementImportJob = {
  userId: string;
  importId: string;
  /** Temporary file written before enqueue; deleted once the parse ends. */
  filePath: string;
  password?: string;
};
