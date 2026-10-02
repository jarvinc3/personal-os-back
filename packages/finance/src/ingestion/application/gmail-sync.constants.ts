export const GMAIL_SYNC_JOB_NAME = 'gmail-sync-source';

export function gmailSyncJobId(sourceId: string): string {
  return `gmail-sync:${sourceId}`;
}

export const GMAIL_SYNC_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1500 },
  removeOnComplete: 100,
  removeOnFail: 300,
};
