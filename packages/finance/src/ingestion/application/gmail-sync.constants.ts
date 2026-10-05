export const GMAIL_SYNC_JOB_NAME = 'gmail-sync-source';

export function gmailSyncJobId(sourceId: string): string {
  // BullMQ rejects ':' in custom job ids; keep it colon-free.
  return `gmail-sync-${sourceId}`;
}

/** Colon-free job ids only; BullMQ rejects any other shape. */
export const GMAIL_SYNC_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1500 },
  // Release the id as soon as the job finishes; the schedule decides when to
  // run again, so a retained finished job must not block the next slot.
  removeOnComplete: true,
  removeOnFail: true,
};
