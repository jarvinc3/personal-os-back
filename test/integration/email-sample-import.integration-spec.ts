import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { getPrismaClientClass } from '@personal-os/database';
import {
  AiSignalConsumerRegistry,
  EmailSampleImportService,
} from '@personal-os/intelligence';
// eslint-disable-next-line no-restricted-imports -- El barrel no expone estos servicios internos.
import { AiEmailClassificationService } from '../../packages/intelligence/src/email/ai-email-classification.service';
// eslint-disable-next-line no-restricted-imports -- El barrel no expone estos servicios internos.
import { AiSignalsService } from '../../packages/intelligence/src/signals/ai-signals.service';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error('Sample import integration tests require TEST_DATABASE_URL');
}
const testUrl = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(testUrl.hostname)) {
  throw new Error('Sample import integration tests require a local database');
}

const pool = new Pool({ connectionString, max: 4 });
const PrismaClient = getPrismaClientClass();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const createdUserIds = new Set<string>();

const financeLabel = {
  relevance: true,
  semanticType: 'FIN_TRANSACTION',
  routes: ['FINANCE'],
  transaction: {
    kind: 'TRANSACTION',
    amount: 88.4,
    currency: 'DOP',
    transactionDate: '2031-05-01T12:00:00.000Z',
    direction: 'DEBIT',
    merchant: 'Comercio sintético #342',
    bankReference: 'SYN-342-REF',
    last4: '4821',
    movementClass: 'PURCHASE',
    bankStatusNormalized: 'APPROVED',
  },
  confidence: 0.91,
};

async function createUser() {
  const userId = randomUUID();
  createdUserIds.add(userId);
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@sample-import.integration.test`,
      fullName: 'Fixture sintética #342',
    },
  });
  const connection = await prisma.aiEmailConnection.create({
    data: {
      userId,
      emailAddress: `${userId}@synthetic.test`,
      accessTokenEncrypted: 'synthetic-fixture-token',
    },
  });
  return { userId, connectionId: connection.id };
}

async function createMessage({
  userId,
  connectionId,
  sender,
  templateFingerprint,
  receivedAt,
}: {
  userId: string;
  connectionId: string;
  sender: string;
  templateFingerprint: string;
  receivedAt: string;
}) {
  const messageId = randomUUID();
  await prisma.aiEmailMessage.create({
    data: {
      id: messageId,
      userId,
      connectionId,
      providerMessageId: randomUUID(),
      receivedAt: new Date(receivedAt),
      fromAddress: sender,
      fromDomain: sender.split('@')[1],
      subject: 'Consumo sintético #342',
      contentFingerprint: randomUUID().replaceAll('-', ''),
      templateFingerprint,
      processingStatus: 'PROCESSED',
      classification: financeLabel as never,
      content: {
        create: { sanitizedBody: 'Cuerpo sintético sin datos reales.' },
      },
    },
  });
  await prisma.aiEmailClassification.create({
    data: {
      userId,
      messageId,
      route: 'FINANCE',
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      transaction: financeLabel.transaction as never,
      confidence: 0.91,
      decisionPath: 'MODEL',
    },
  });
  return messageId;
}

function buildService({
  consume,
  preview = jest.fn().mockResolvedValue({
    outcome: 'APPLIED',
    movement: {
      accountId: 'account-1',
      cardId: null,
      amount: 88.4,
      currency: 'DOP',
      type: 'DEBIT',
      status: 'CONFIRMED',
      transactionDate: '2031-05-01T12:00:00.000Z',
      description: 'Comercio sintético #342',
      categoryId: null,
      legRole: null,
      externalReference: 'SYN-342-REF',
      importReference: 'email-preview',
    },
  }),
}: {
  consume: jest.Mock;
  preview?: jest.Mock;
}): EmailSampleImportService {
  const inference = {
    infer: jest.fn().mockResolvedValue({
      provider: 'integration',
      model: 'integration-model',
      value: financeLabel,
    }),
  };
  const classification = new AiEmailClassificationService(
    prisma as never,
    inference as never,
    { get: () => 100 } as never,
  );
  const registry = new AiSignalConsumerRegistry();
  registry.register({ domain: 'FINANCE', consume, preview });
  return new EmailSampleImportService(
    prisma as never,
    classification,
    registry,
    new AiSignalsService(prisma),
  );
}

async function countClassifications(messageId: string) {
  return prisma.aiEmailClassification.count({ where: { messageId } });
}

async function readMessage(messageId: string) {
  return prisma.aiEmailMessage.findUniqueOrThrow({ where: { id: messageId } });
}

describe('Selección acotada de muestra por lista explícita', () => {
  afterAll(async () => {
    const userIds = [...createdUserIds];
    if (userIds.length) {
      await prisma.aiSignalEvidence.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.aiSignal.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.aiEmailClassification.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.aiKnowledgeObservation.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.aiAnalysisRun.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.aiDatasetItem.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.aiEmailModelBudget.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.aiEmailMessage.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.aiEmailConnection.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    await pool.end();
  });

  it('no escribe nada en vista previa y no toca el correo vecino de la misma plantilla', async () => {
    const { userId, connectionId } = await createUser();
    const sender = 'alertas@synthetic-bank.test';
    const template = `sample-${randomUUID()}`;
    const selectedId = await createMessage({
      userId,
      connectionId,
      sender,
      templateFingerprint: template,
      receivedAt: '2031-05-01T12:00:00.000Z',
    });
    const neighbourId = await createMessage({
      userId,
      connectionId,
      sender,
      templateFingerprint: template,
      receivedAt: '2031-05-02T12:00:00.000Z',
    });
    const neighbourBefore = await readMessage(neighbourId);
    const consume = jest.fn();
    const service = buildService({ consume });

    const manifest = await service.run({
      userId,
      dryRun: true,
      selection: { messageIds: [selectedId] },
    });

    expect(manifest.items[0]).toMatchObject({
      messageId: selectedId,
      status: 'INCLUDED',
      signal: { published: true },
      prediction: { outcome: 'APPLIED' },
    });
    expect(consume).not.toHaveBeenCalled();
    await expect(countClassifications(selectedId)).resolves.toBe(1);
    await expect(prisma.aiSignal.count({ where: { userId } })).resolves.toBe(0);
    const neighbourAfter = await readMessage(neighbourId);
    expect(neighbourAfter.updatedAt).toEqual(neighbourBefore.updatedAt);
    expect(neighbourAfter.processingStatus).toBe('PROCESSED');
    expect(neighbourAfter.classification).toEqual(
      neighbourBefore.classification,
    );
  });

  it('ejecuta solo el id pedido y repetir no duplica señal ni clasificación', async () => {
    const { userId, connectionId } = await createUser();
    const sender = 'alertas@synthetic-bank.test';
    const template = `sample-${randomUUID()}`;
    const selectedId = await createMessage({
      userId,
      connectionId,
      sender,
      templateFingerprint: template,
      receivedAt: '2031-05-03T12:00:00.000Z',
    });
    const neighbourId = await createMessage({
      userId,
      connectionId,
      sender,
      templateFingerprint: template,
      receivedAt: '2031-05-04T12:00:00.000Z',
    });
    const neighbourBefore = await readMessage(neighbourId);
    const consume = jest
      .fn()
      .mockResolvedValueOnce({
        outcome: 'APPLIED',
        domainReferences: [{ type: 'FinTransaction', id: 'transaction-1' }],
      })
      .mockResolvedValueOnce({
        outcome: 'ALREADY_APPLIED',
        domainReferences: [{ type: 'FinTransaction', id: 'transaction-1' }],
      });
    const service = buildService({ consume });

    const first = await service.run({
      userId,
      dryRun: false,
      selection: { messageIds: [selectedId] },
    });
    const second = await service.run({
      userId,
      dryRun: false,
      selection: { messageIds: [selectedId] },
    });

    expect(first.items[0].execution).toMatchObject({
      outcome: 'APPLIED',
      transactionId: 'transaction-1',
    });
    expect(second.items[0].execution).toMatchObject({
      outcome: 'ALREADY_APPLIED',
      transactionId: 'transaction-1',
    });
    expect(consume).toHaveBeenCalledTimes(2);
    const signals = await prisma.aiSignal.findMany({
      where: { userId },
      select: { id: true, status: true, sourceId: true },
    });
    expect(signals).toEqual([
      {
        id: `email-${selectedId}`,
        status: 'CONSUMED',
        sourceId: selectedId,
      },
    ]);
    await expect(countClassifications(selectedId)).resolves.toBe(1);
    const neighbourAfter = await readMessage(neighbourId);
    expect(neighbourAfter.updatedAt).toEqual(neighbourBefore.updatedAt);
    expect(neighbourAfter.processingStatus).toBe('PROCESSED');
    expect(neighbourAfter.classification).toEqual(
      neighbourBefore.classification,
    );
  });

  it('devuelve el correo pedido como no encontrado sin escribir', async () => {
    const { userId } = await createUser();
    const consume = jest.fn();
    const service = buildService({ consume });

    const manifest = await service.run({
      userId,
      dryRun: false,
      selection: { messageIds: [randomUUID()] },
    });

    expect(manifest.items[0]).toMatchObject({
      status: 'NOT_FOUND',
      signal: { published: false, reason: 'MESSAGE_NOT_FOUND' },
    });
    expect(consume).not.toHaveBeenCalled();
    await expect(prisma.aiSignal.count({ where: { userId } })).resolves.toBe(0);
  });
});
