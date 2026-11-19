import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { getPrismaClientClass } from '@personal-os/database';
// eslint-disable-next-line no-restricted-imports -- El barrel no expone el servicio interno.
import { AiEmailSourceService } from '../../packages/intelligence/src/email/ai-email-source.service';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error('Messages list integration tests require TEST_DATABASE_URL');
}
const testUrl = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(testUrl.hostname)) {
  throw new Error('Messages list integration tests require a local database');
}

const pool = new Pool({ connectionString, max: 4 });
const PrismaClient = getPrismaClientClass();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const createdUserIds = new Set<string>();
const service = new AiEmailSourceService(prisma as never, {} as never);

type MessageFixture = {
  userId: string;
  connectionId: string;
  index: number;
  subject: string;
  fromAddress: string;
  processingStatus: 'PROCESSED' | 'REVIEW_REQUIRED' | 'INGESTED';
};

async function createUser() {
  const userId = randomUUID();
  createdUserIds.add(userId);
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@messages-list.integration.test`,
      fullName: 'Fixture de búsqueda de correos',
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

async function createMessage(fixture: MessageFixture) {
  const message = await prisma.aiEmailMessage.create({
    data: {
      userId: fixture.userId,
      connectionId: fixture.connectionId,
      providerMessageId: randomUUID(),
      receivedAt: new Date(Date.UTC(2026, 9, 1, 10, fixture.index)),
      fromAddress: fixture.fromAddress,
      fromDomain: fixture.fromAddress.split('@')[1] ?? 'synthetic.test',
      subject: fixture.subject,
      contentFingerprint: randomUUID().replaceAll('-', ''),
      processingStatus: fixture.processingStatus,
    },
  });
  return message.id;
}

describe('Lista de correos importados', () => {
  afterAll(async () => {
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

  it('encuentra por asunto y remitente fuera de la primera página sin distinguir mayúsculas', async () => {
    const { userId, connectionId } = await createUser();
    const others = await createUser();
    const firstPageSubjects = Array.from({ length: 50 }, (_, index) =>
      createMessage({
        userId,
        connectionId,
        index,
        subject: `Consumo ${index}`,
        fromAddress: 'alertas@banco.com',
        processingStatus: 'PROCESSED',
      }),
    );
    await Promise.all(firstPageSubjects);
    const bySender = await createMessage({
      userId,
      connectionId,
      index: 50,
      subject: 'Aviso de pago',
      fromAddress: 'Facturas@Banco.com.do',
      processingStatus: 'PROCESSED',
    });
    const bySubject = await createMessage({
      userId,
      connectionId,
      index: 51,
      subject: 'FACTURA de noviembre',
      fromAddress: 'alertas@banco.com',
      processingStatus: 'PROCESSED',
    });
    await createMessage({
      userId: others.userId,
      connectionId: others.connectionId,
      index: 0,
      subject: 'Factura ajena',
      fromAddress: 'alertas@banco.com',
      processingStatus: 'PROCESSED',
    });

    const firstPage = await service.listMessages({ userId });
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.items.map(({ id }) => id)).not.toContain(bySubject);

    const search = await service.listMessages({ userId, q: 'factura' });

    expect(search.items.map(({ id }) => id)).toEqual([bySender, bySubject]);
  });

  it('combina el estado con el cursor y solo devuelve ese estado', async () => {
    const { userId, connectionId } = await createUser();
    await Promise.all(
      Array.from({ length: 60 }, (_, index) =>
        createMessage({
          userId,
          connectionId,
          index,
          subject: `Consumo ${index}`,
          fromAddress: 'alertas@banco.com',
          processingStatus: 'PROCESSED',
        }),
      ),
    );
    const inReview = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        createMessage({
          userId,
          connectionId,
          index: 60 + index,
          subject: `Revisión ${index}`,
          fromAddress: 'alertas@banco.com',
          processingStatus: 'REVIEW_REQUIRED',
        }),
      ),
    );

    const firstPage = await service.listMessages({
      userId,
      status: 'PROCESSED',
    });
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.hasMore).toBe(true);
    expect(
      firstPage.items.every(
        ({ processingStatus }) => processingStatus === 'PROCESSED',
      ),
    ).toBe(true);

    const secondPage = await service.listMessages({
      userId,
      status: 'PROCESSED',
      cursor: firstPage.nextCursor ?? '',
    });
    expect(secondPage.items).toHaveLength(10);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.items.map(({ id }) => id)).not.toEqual(
      expect.arrayContaining(inReview),
    );
  });
});
