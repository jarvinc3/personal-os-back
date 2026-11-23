import type { PrismaService } from '@personal-os/database';
import { EMAIL_SOURCE_TYPE } from './email-evidence.constants';
import { partitionEmailDatasetItem } from './dataset-partition.util';
import { EMAIL_DATASET_NAME, EMAIL_DATASET_PURPOSE } from './dataset.constants';

/** El dataset de correo y sus particiones, listo para las demás lecturas. */
export class EmailEvidenceDataset {
  constructor(private readonly prisma: PrismaService) {}

  async summary(userId: string) {
    const dataset = await this.ensure();
    await this.ensureItems(userId, dataset.id);
    const counts = await this.prisma.aiDatasetItem.groupBy({
      by: ['partition'],
      where: { datasetId: dataset.id, userId },
      _count: { _all: true },
    });
    return {
      id: dataset.id,
      name: dataset.name,
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

  ensure() {
    return this.prisma.aiDataset.upsert({
      where: { name: EMAIL_DATASET_NAME },
      create: {
        name: EMAIL_DATASET_NAME,
        purpose: EMAIL_DATASET_PURPOSE,
      },
      update: {},
    });
  }

  async ensureItems(userId: string, datasetId: string) {
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
