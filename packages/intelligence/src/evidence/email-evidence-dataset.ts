import type { PrismaService } from '@personal-os/database';
import { EMAIL_SOURCE_TYPE } from './email-evidence.constants';
import { partitionEmailDatasetItem } from './dataset-partition.util';
import { EMAIL_DATASET_NAME, EMAIL_DATASET_PURPOSE } from './dataset.constants';

type DatasetIdentity = {
  id: string;
  name: string;
};

type DatasetSummary = DatasetIdentity & {
  partitions: {
    TRAIN: number;
    VALIDATION: number;
    HOLDOUT: number;
  };
};

/** El dataset de correo: preparación explícita y lectura de sus particiones. */
export class EmailEvidenceDataset {
  constructor(private readonly prisma: PrismaService) {}

  async prepare(userId: string): Promise<DatasetIdentity> {
    const dataset = await this.ensure();
    await this.ensureItems(userId, dataset.id);
    return dataset;
  }

  async summary(userId: string): Promise<DatasetSummary> {
    const dataset = await this.find();
    const counts = dataset
      ? await this.prisma.aiDatasetItem.groupBy({
          by: ['partition'],
          where: { datasetId: dataset.id, userId },
          _count: { _all: true },
        })
      : [];
    return {
      id: dataset?.id ?? '',
      name: dataset?.name ?? EMAIL_DATASET_NAME,
      partitions: {
        TRAIN:
          counts.find((item) => item.partition === 'TRAIN')?._count._all ?? 0,
        VALIDATION:
          counts.find((item) => item.partition === 'VALIDATION')?._count._all ??
          0,
        HOLDOUT:
          counts.find((item) => item.partition === 'HOLDOUT')?._count._all ?? 0,
      },
    };
  }

  private find(): Promise<DatasetIdentity | null> {
    return this.prisma.aiDataset.findUnique({
      where: { name: EMAIL_DATASET_NAME },
      select: { id: true, name: true },
    });
  }

  private ensure(): Promise<DatasetIdentity> {
    return this.prisma.aiDataset.upsert({
      where: { name: EMAIL_DATASET_NAME },
      create: {
        name: EMAIL_DATASET_NAME,
        purpose: EMAIL_DATASET_PURPOSE,
      },
      update: {},
      select: { id: true, name: true },
    });
  }

  private async ensureItems(userId: string, datasetId: string): Promise<void> {
    const [messages, existing] = await Promise.all([
      this.prisma.aiEmailMessage.findMany({
        where: { userId },
        select: { id: true },
      }),
      this.prisma.aiDatasetItem.findMany({
        where: { datasetId, userId, sourceType: EMAIL_SOURCE_TYPE },
        select: { sourceId: true },
      }),
    ]);
    const included = new Set(existing.map(({ sourceId }) => sourceId));
    const missing = messages.filter(({ id }) => !included.has(id));
    if (!missing.length) {
      return;
    }
    await this.prisma.aiDatasetItem.createMany({
      data: missing.map(({ id }) => ({
        datasetId,
        userId,
        sourceType: EMAIL_SOURCE_TYPE,
        sourceId: id,
        partition: partitionEmailDatasetItem(userId, id),
      })),
      skipDuplicates: true,
    });
  }
}
