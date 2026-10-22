import type { Prisma } from '@personal-os/database';
import type { DomainEventPublisherPort } from '../../events/application/ports/domain-event-publisher.port';
import { notificationTransactionPayload } from '../../shared/domain/mappers';

const transactionNotificationInclude = {
  account: { select: { name: true } },
  card: { select: { name: true } },
  category: { select: { name: true, icon: true, color: true } },
} satisfies Prisma.FinTransactionInclude;

type EnqueueTransactionEventInput = {
  tx: Prisma.TransactionClient;
  events: DomainEventPublisherPort;
  userId: string;
  eventName: string;
  transactionId: string;
};

/** Announces a movement with the parties every notification consumer reads. */
export async function enqueueTransactionEvent({
  tx,
  events,
  userId,
  eventName,
  transactionId,
}: EnqueueTransactionEventInput) {
  const row = await tx.finTransaction.findFirst({
    where: { id: transactionId, userId },
    include: transactionNotificationInclude,
  });
  if (!row) {
    return;
  }

  await events.enqueue(
    {
      eventName,
      aggregateType: 'FinTransaction',
      aggregateId: transactionId,
      userId,
      payload: notificationTransactionPayload(row),
    },
    tx,
  );
}
