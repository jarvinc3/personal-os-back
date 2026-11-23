import type { PrismaService } from '@personal-os/database';

export type MessageImportFilters = {
  importStartAt: Date | null;
  senderFilter: string | null;
};

export type ScopedBhdSyncScope = {
  dateFrom: Date;
  dateTo: Date;
  maxMessages: number;
  pageToken?: string;
};

export type ScopedBhdSyncResult = {
  connected: true;
  query: string;
  found: number;
  imported: number;
  skipped: number;
  nextPageToken: string | null;
  estimatedTotal: number | null;
};

export type GmailSyncProgress = {
  status:
    'running' | 'waiting' | 'retrying' | 'scheduled' | 'completed' | 'failed';
  phase: 'bootstrap' | 'incremental' | 'recovery' | 'classifying';
  attempt: number;
  rateLimitRetryCount?: number;
  processedThisRun: number;
  importedThisRun: number;
  batchSize?: number;
  totalEstimate?: number;
  retryAt?: number;
  nextRunAt?: number;
  errorCode?: string;
  providerErrorCode?: string;
  recoveryRange?: { from: string; to: string };
  errorCategory?:
    'authorization' | 'configuration' | 'rate_limit' | 'temporary' | 'unknown';
  startedAt: string;
  updatedAt: string;
};

export type GmailSyncProgressPatch = Partial<GmailSyncProgress>;

export type GmailSyncPhase = GmailSyncProgress['phase'];

export type GmailSyncRetryResult = {
  connected: true;
  imported: 0;
  retryScheduled: true;
};

export type GmailRetryState = {
  status: 'waiting' | 'retrying';
  retryAt?: number;
  attempt: number;
  errorCategory: 'rate_limit' | 'temporary';
};

export type GmailMessageList = {
  messages?: Array<{ id: string; threadId?: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

export type GmailHistoryPage = {
  historyId?: string;
  nextPageToken?: string;
  history?: Array<{
    messagesAdded?: Array<{ message?: { id?: string } }>;
  }>;
};

export type GmailPart = {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
};

export type GmailConnectionRecord = NonNullable<
  Awaited<ReturnType<PrismaService['aiEmailConnection']['findUnique']>>
>;
