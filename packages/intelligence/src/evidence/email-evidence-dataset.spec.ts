import { partitionEmailDatasetItem } from './dataset-partition.util';
import { EMAIL_SOURCE_TYPE } from './email-evidence.constants';
import { EmailEvidenceDataset } from './email-evidence-dataset';

describe('EmailEvidenceDataset', () => {
  const makePrisma = () => ({
    aiDataset: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'dataset-1', name: 'EMAIL_V1' }),
      upsert: jest
        .fn()
        .mockResolvedValue({ id: 'dataset-1', name: 'EMAIL_V1' }),
    },
    aiDatasetItem: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    aiEmailMessage: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  });

  it('creates the dataset and only the missing items with their partitions', async () => {
    const prisma = makePrisma();
    prisma.aiEmailMessage.findMany.mockResolvedValue([
      { id: 'email-1' },
      { id: 'email-2' },
    ]);
    prisma.aiDatasetItem.findMany.mockResolvedValue([{ sourceId: 'email-1' }]);
    const dataset = new EmailEvidenceDataset(prisma);

    await expect(dataset.prepare('user-1')).resolves.toEqual({
      id: 'dataset-1',
      name: 'EMAIL_V1',
    });
    expect(prisma.aiDatasetItem.createMany).toHaveBeenCalledWith({
      data: [
        {
          datasetId: 'dataset-1',
          userId: 'user-1',
          sourceType: EMAIL_SOURCE_TYPE,
          sourceId: 'email-2',
          partition: partitionEmailDatasetItem('user-1', 'email-2'),
        },
      ],
      skipDuplicates: true,
    });
  });

  it('does not add items when every message already has its row', async () => {
    const prisma = makePrisma();
    prisma.aiEmailMessage.findMany.mockResolvedValue([{ id: 'email-1' }]);
    prisma.aiDatasetItem.findMany.mockResolvedValue([{ sourceId: 'email-1' }]);
    const dataset = new EmailEvidenceDataset(prisma);

    await dataset.prepare('user-1');

    expect(prisma.aiDatasetItem.createMany).not.toHaveBeenCalled();
  });
});
