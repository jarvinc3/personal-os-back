import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { getPrismaClientClass } from '@personal-os/database';
// eslint-disable-next-line no-restricted-imports -- El barrel no expone el servicio interno.
import { AiEmailClassificationService } from '../../packages/intelligence/src/email/ai-email-classification.service';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'Classification limits integration tests require TEST_DATABASE_URL',
  );
}
const testUrl = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(testUrl.hostname)) {
  throw new Error(
    'Classification limits integration tests require a local database',
  );
}

const pool = new Pool({ connectionString, max: 4 });
const PrismaClient = getPrismaClientClass();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const createdUserIds = new Set<string>();

const modelLabel = {
  relevance: true,
  semanticType: 'FIN_TRANSACTION',
  routes: ['FINANCE'],
  transaction: {
    kind: 'TRANSACTION',
    amount: 25.5,
    currency: 'DOP',
    transactionDate: '2031-06-01T12:00:00.000Z',
    direction: 'DEBIT',
    merchant: 'Comercio sintético de límites',
    movementClass: 'PURCHASE',
  },
  confidence: 0.9,
};

function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

async function createUserWithMessage() {
  const userId = randomUUID();
  createdUserIds.add(userId);
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@classification-limits.integration.test`,
      fullName: 'Fixture de límites de clasificación',
    },
  });
  const connection = await prisma.aiEmailConnection.create({
    data: {
      userId,
      emailAddress: `${userId}@synthetic.test`,
      accessTokenEncrypted: 'synthetic-fixture-token',
    },
  });
  const messageId = randomUUID();
  await prisma.aiEmailMessage.create({
    data: {
      id: messageId,
      userId,
      connectionId: connection.id,
      providerMessageId: randomUUID(),
      receivedAt: new Date(),
      fromAddress: 'Alertas@bhd.com.do',
      fromDomain: 'bhd.com.do',
      subject: 'Aviso sintético de límites',
      contentFingerprint: randomUUID().replaceAll('-', ''),
      processingStatus: 'INGESTED',
      content: {
        create: { sanitizedBody: 'Cuerpo sintético sin formato fijo.' },
      },
    },
  });
  return { userId, messageId };
}

function buildService() {
  const inference = {
    infer: jest.fn().mockResolvedValue({
      provider: 'integration',
      model: 'integration-model',
      value: modelLabel,
      fallbackCount: 0,
      inputTokens: null,
      outputTokens: null,
    }),
  };
  const service = new AiEmailClassificationService(
    prisma,
    inference as never,
    { get: () => 100 } as never,
  );
  return { service, inference };
}

async function seedMinuteCalls({
  userId,
  calls,
}: {
  userId: string;
  calls: number;
}) {
  await prisma.$executeRaw`
    INSERT INTO ai_email_classification_minutes (user_id, minute, calls)
    VALUES (${userId}, date_trunc('minute', now()), ${calls})
    ON CONFLICT (user_id, minute) DO UPDATE SET calls = ${calls}
  `;
}

async function readMinuteCalls(userId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ calls: number }>>`
    SELECT calls FROM ai_email_classification_minutes WHERE user_id = ${userId}
  `;
  return rows[0]?.calls ?? 0;
}

describe('Límites compartidos de clasificación sobre PostgreSQL', () => {
  beforeEach(async () => {
    await prisma.aiEmailDailyCost.deleteMany({
      where: { date: startOfUtcDay(new Date()) },
    });
  });

  afterAll(async () => {
    await prisma.aiEmailDailyCost.deleteMany({
      where: { date: startOfUtcDay(new Date()) },
    });
    const userIds = [...createdUserIds];
    if (userIds.length) {
      await prisma.aiEmailClassification.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    await pool.end();
  });

  it('no clasifica cuando el contador del minuto ya llegó a 20', async () => {
    const { userId, messageId } = await createUserWithMessage();
    await seedMinuteCalls({ userId, calls: 20 });
    const { service, inference } = buildService();

    await expect(
      service.previewClassification({ userId, messageId }),
    ).resolves.toEqual({ kind: 'unavailable', reason: 'RATE_LIMITED' });
    expect(inference.infer).not.toHaveBeenCalled();

    await seedMinuteCalls({ userId, calls: 19 });
    await expect(
      service.previewClassification({ userId, messageId }),
    ).resolves.toMatchObject({ kind: 'classified' });
    expect(inference.infer).toHaveBeenCalledTimes(1);
    await expect(readMinuteCalls(userId)).resolves.toBe(20);
  });

  it('reserva el costo global en la vista previa sin consumir el cupo diario', async () => {
    const { userId, messageId } = await createUserWithMessage();
    const { service, inference } = buildService();

    await expect(
      service.previewClassification({ userId, messageId }),
    ).resolves.toMatchObject({ kind: 'classified' });
    expect(inference.infer).toHaveBeenCalledTimes(1);
    const dailyCost = await prisma.aiEmailDailyCost.findUniqueOrThrow({
      where: { date: startOfUtcDay(new Date()) },
    });
    expect(Number(dailyCost.costUsd)).toBe(0.02);
    await expect(
      prisma.aiEmailModelBudget.findUnique({ where: { userId } }),
    ).resolves.toBeNull();
  });

  it('no llama al modelo cuando el costo máximo no cabe bajo el tope diario', async () => {
    const { userId, messageId } = await createUserWithMessage();
    const date = startOfUtcDay(new Date());
    await prisma.aiEmailDailyCost.create({
      data: { date, costUsd: 4.99 },
    });
    const { service, inference } = buildService();

    await expect(service.processPendingForUser(userId)).resolves.toEqual({
      processed: 0,
      modelCalls: 0,
      rateLimited: false,
    });
    expect(inference.infer).not.toHaveBeenCalled();
    const message = await prisma.aiEmailMessage.findUniqueOrThrow({
      where: { id: messageId },
    });
    expect(message.processingStatus).toBe('QUEUED');
    await expect(
      prisma.aiEmailModelBudget.findUnique({ where: { userId } }),
    ).resolves.toMatchObject({ calls: 0 });
    const dailyCost = await prisma.aiEmailDailyCost.findUniqueOrThrow({
      where: { date },
    });
    expect(Number(dailyCost.costUsd)).toBe(4.99);
  });
});
