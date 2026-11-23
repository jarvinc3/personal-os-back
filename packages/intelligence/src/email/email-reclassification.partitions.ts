import type { PrismaService } from '@personal-os/database';
import { partitionEmailDatasetItem } from '../evidence/dataset-partition.util';
import { EMAIL_SOURCE_TYPE } from '../evidence/email-evidence.constants';

/**
 * Partición de cada correo. Un correo sin fila en el dataset usa la partición
 * que le tocaría, para no tratar como elegible algo que no está registrado.
 */
export async function readEmailPartitions({
  prisma,
  userId,
  messageIds,
}: {
  prisma: PrismaService;
  userId: string;
  messageIds: readonly string[];
}): Promise<Map<string, string>> {
  const items = await prisma.aiDatasetItem.findMany({
    where: {
      userId,
      sourceType: EMAIL_SOURCE_TYPE,
      sourceId: { in: [...messageIds] },
    },
    select: { sourceId: true, partition: true },
  });
  const partitions = new Map(
    items.map(({ sourceId, partition }) => [sourceId, partition]),
  );
  for (const messageId of messageIds) {
    if (!partitions.has(messageId)) {
      partitions.set(messageId, partitionEmailDatasetItem(userId, messageId));
    }
  }
  return partitions;
}
