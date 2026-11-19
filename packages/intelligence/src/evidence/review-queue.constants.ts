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

/**
 * Un correo PROCESSED o DISCARDED ya no requiere revisión y sale de la cola
 * pendiente: el primero tiene clasificación y el segundo quedó fuera del
 * piloto porque su remitente no es bancario.
 */
export const REVIEW_QUEUE_RESOLVED_PROCESSING_STATUSES = [
  'PROCESSED',
  'DISCARDED',
] as const;

export const REVIEW_QUEUE_ORDERS = ['OLDEST', 'NEWEST', 'IMPACT'] as const;

export type ReviewQueueOrder = (typeof REVIEW_QUEUE_ORDERS)[number];

export const REVIEW_QUEUE_DEFAULT_ORDER: ReviewQueueOrder = 'OLDEST';
