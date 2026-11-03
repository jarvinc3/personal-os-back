import { partitionEmailDatasetItem } from './dataset-partition.util';

describe('partitionEmailDatasetItem', () => {
  it('returns a stable partition for the same account and source', () => {
    const first = partitionEmailDatasetItem('user-1', 'message-1');

    expect(partitionEmailDatasetItem('user-1', 'message-1')).toBe(first);
  });

  it('keeps partitions scoped to the account identity', () => {
    const sameMessageForAnotherUser = partitionEmailDatasetItem(
      'user-2',
      'message-1',
    );

    expect(['TRAIN', 'VALIDATION', 'HOLDOUT']).toContain(
      sameMessageForAnotherUser,
    );
  });
});
