export const SAMPLE_IMPORT_JOB_NAME = 'run-sample-import' as const;

/**
 * One attempt: the job row keeps the terminal state, so a lost worker is
 * recovered by asking again with the same selection, which is idempotent.
 * The queue id is the row id, so a second enqueue of the same job is a no-op.
 */
export const SAMPLE_IMPORT_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
} as const;

export const SAMPLE_IMPORT_ERROR = {
  RUN_FAILED: 'SAMPLE_IMPORT_FAILED',
} as const;
