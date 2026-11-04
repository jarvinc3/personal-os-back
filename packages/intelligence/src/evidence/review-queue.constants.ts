export const REVIEW_QUEUE_PAGE_SIZE = 50;

export const REVIEW_QUEUE_PARTITIONS = [
  'TRAIN',
  'VALIDATION',
  'HOLDOUT',
] as const;

export type ReviewQueuePartition = (typeof REVIEW_QUEUE_PARTITIONS)[number];

export const REVIEW_QUEUE_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'CORRECTED',
  'REJECTED',
] as const;

export type ReviewQueueStatus = (typeof REVIEW_QUEUE_STATUSES)[number];

export const REVIEW_QUEUE_PENDING_STATUS: ReviewQueueStatus = 'PENDING';

export const REVIEW_QUEUE_ORDERS = ['OLDEST', 'NEWEST'] as const;

export type ReviewQueueOrder = (typeof REVIEW_QUEUE_ORDERS)[number];

export const REVIEW_QUEUE_DEFAULT_ORDER: ReviewQueueOrder = 'OLDEST';
