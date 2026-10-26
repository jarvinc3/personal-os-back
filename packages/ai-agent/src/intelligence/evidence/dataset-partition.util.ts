import { createHash } from 'node:crypto';

export type EmailDatasetPartition = 'TRAIN' | 'VALIDATION' | 'HOLDOUT';

export function partitionEmailDatasetItem(
  userId: string,
  sourceId: string,
): EmailDatasetPartition {
  const bucket =
    createHash('sha256').update(`${userId}:${sourceId}`).digest()[0] % 100;
  if (bucket < 80) {
    return 'TRAIN';
  }
  return bucket < 90 ? 'VALIDATION' : 'HOLDOUT';
}
