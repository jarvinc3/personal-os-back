import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { getPrismaClientClass } from '@personal-os/database';
import {
  AiEvidenceService,
  EMAIL_DATASET_NAME,
  EMAIL_DATASET_PURPOSE,
} from '@personal-os/intelligence';
// eslint-disable-next-line no-restricted-imports -- El test ejercita el controller real, que el barrel no expone.
import { AiEvidenceController } from '../../packages/intelligence/src/evidence/ai-evidence.controller';
// eslint-disable-next-line no-restricted-imports -- El test construye el DTO transformado que recibe el handler.
import { CreateHumanVerificationDto } from '../../packages/intelligence/src/evidence/dto/create-human-verification.dto';
// eslint-disable-next-line no-restricted-imports -- El test construye el DTO real que recibe la ruta por lote.
import { CreateReviewSelectionVerificationDto } from '../../packages/intelligence/src/evidence/dto/create-review-selection-verification.dto';
// eslint-disable-next-line no-restricted-imports -- El test verifica la instancia anidada que produce ValidationPipe.
import { HumanVerificationTransactionDto } from '../../packages/intelligence/src/evidence/dto/human-verification-labels.dto';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error('CTR-02 integration tests require TEST_DATABASE_URL');
}
const testUrl = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(testUrl.hostname)) {
  throw new Error('CTR-02 integration tests require a local database');
}

const pool = new Pool({ connectionString, max: 4 });
const PrismaClient = getPrismaClientClass();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const createdUserIds = new Set<string>();

const transaction = {
  kind: 'TRANSACTION' as const,
  amount: 37.25,
  currency: 'DOP',
  transactionDate: '2031-04-12T12:00:00.000Z',
  direction: 'DEBIT' as const,
  merchant: 'Comercio sintético CTR-02',
  bankReference: 'SYN-CTR02-REF',
  last4: '4821',
};
const verificationBody = {
  verdict: 'CORRECTED' as const,
  relevance: true,
  semanticType: 'FIN_TRANSACTION' as const,
  routes: ['FINANCE' as const],
  transaction,
  notes: 'Reintento sintético CTR-02',
};

function transformedRequest() {
  return plainToInstance(CreateHumanVerificationDto, verificationBody);
}

async function validateRequest(request: object) {
  await validateOrReject(request, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

async function createFixture() {
  const userId = randomUUID();
  createdUserIds.add(userId);
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@ctr02.integration.test`,
      fullName: 'Fixture sintética CTR-02',
    },
  });
  const connection = await prisma.aiEmailConnection.create({
    data: {
      userId,
      emailAddress: `${userId}@synthetic.test`,
      accessTokenEncrypted: 'synthetic-fixture-token',
    },
  });
  const dataset = await prisma.aiDataset.upsert({
    where: { name: EMAIL_DATASET_NAME },
    create: {
      name: EMAIL_DATASET_NAME,
      purpose: EMAIL_DATASET_PURPOSE,
      sourceType: 'EMAIL',
    },
    update: {},
  });
  const messageId = randomUUID();
  await prisma.aiEmailMessage.create({
    data: {
      id: messageId,
      userId,
      connectionId: connection.id,
      providerMessageId: randomUUID(),
      receivedAt: new Date('2031-04-12T12:00:00.000Z'),
      fromAddress: 'alertas@synthetic-bank.test',
      fromDomain: 'synthetic-bank.test',
      subject: 'Consumo sintético CTR-02',
      contentFingerprint: randomUUID().replaceAll('-', ''),
      templateFingerprint: `ctr02-${randomUUID()}`,
      processingStatus: 'PROCESSED',
      classification: {
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction,
        confidence: 0.31,
      } as never,
    },
  });
  await prisma.aiDatasetItem.create({
    data: {
      datasetId: dataset.id,
      userId,
      sourceType: 'EMAIL_MESSAGE',
      sourceId: messageId,
      partition: 'TRAIN',
    },
  });
  const previous = await prisma.aiHumanVerification.create({
    data: {
      userId,
      verifierRole: 'USER',
      targetType: 'EMAIL_MESSAGE',
      targetId: messageId,
      verdict: 'CONFIRMED',
      correctedPayload: null,
      notes: null,
      isGroundTruth: false,
    },
  });
  return { userId, messageId, previous };
}

function evidenceService(reclassify: () => Promise<{ requeued: number }>) {
  return new AiEvidenceService(prisma as never, {
    reclassifyAfterMessageVerification: reclassify,
    reclassifyAfterReviewGroupVerification: () =>
      Promise.resolve({ requeued: 0 }),
  });
}

async function messageVerifications(userId: string, messageId: string) {
  return prisma.aiHumanVerification.findMany({
    where: {
      userId,
      targetType: 'EMAIL_MESSAGE',
      targetId: messageId,
    },
    orderBy: { sequence: 'asc' },
  });
}

describe('CTR-02 idempotencia de verificaciones con DTO transformado', () => {
  afterAll(async () => {
    const userIds = [...createdUserIds];
    if (userIds.length) {
      await prisma.aiHumanVerification.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.aiDatasetItem.deleteMany({
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

  it('reutiliza la verificación idéntica con DTO transformado y preserva la previa', async () => {
    const fixture = await createFixture();
    const controller = new AiEvidenceController(
      evidenceService(() => Promise.resolve({ requeued: 0 })),
    );
    const firstRequest = transformedRequest();
    const repeatedRequest = transformedRequest();
    expect(firstRequest.transaction).toBeInstanceOf(
      HumanVerificationTransactionDto,
    );
    expect(repeatedRequest.transaction).toBeInstanceOf(
      HumanVerificationTransactionDto,
    );
    await validateRequest(firstRequest);
    await validateRequest(repeatedRequest);

    const first = await controller.verifyMessage(
      { sub: fixture.userId },
      fixture.messageId,
      firstRequest,
    );
    const afterFirst = await messageVerifications(
      fixture.userId,
      fixture.messageId,
    );
    const repeated = await controller.verifyMessage(
      { sub: fixture.userId },
      fixture.messageId,
      repeatedRequest,
    );
    const afterRepeat = await messageVerifications(
      fixture.userId,
      fixture.messageId,
    );

    expect(afterFirst).toHaveLength(2);
    expect(afterRepeat).toHaveLength(2);
    expect(repeated.sequence).toBe(first.sequence);
    expect(afterRepeat[0]).toMatchObject({
      sequence: fixture.previous.sequence,
      verdict: 'CONFIRMED',
      notes: null,
      isGroundTruth: false,
    });
    expect(afterRepeat[1]).toMatchObject({
      sequence: BigInt(first.sequence),
      verdict: 'CORRECTED',
      notes: verificationBody.notes,
      isGroundTruth: false,
    });
  });

  it('reintenta después de un fallo de reclasificación sin duplicar la verificación', async () => {
    const fixture = await createFixture();
    let shouldFail = true;
    const controller = new AiEvidenceController(
      evidenceService(() => {
        if (shouldFail) {
          shouldFail = false;
          return Promise.reject(
            new Error('fallo sintético de reclasificación'),
          );
        }
        return Promise.resolve({ requeued: 0 });
      }),
    );
    const firstRequest = transformedRequest();
    const repeatedRequest = transformedRequest();
    await validateRequest(firstRequest);
    await validateRequest(repeatedRequest);

    await expect(
      controller.verifyMessage(
        { sub: fixture.userId },
        fixture.messageId,
        firstRequest,
      ),
    ).rejects.toThrow('no se pudo reclasificar');
    const afterFailure = await messageVerifications(
      fixture.userId,
      fixture.messageId,
    );
    expect(afterFailure).toHaveLength(2);

    const repeated = await controller.verifyMessage(
      { sub: fixture.userId },
      fixture.messageId,
      repeatedRequest,
    );
    const afterRetry = await messageVerifications(
      fixture.userId,
      fixture.messageId,
    );

    expect(afterRetry).toHaveLength(2);
    expect(repeated.sequence).toBe(
      afterRetry
        .find(({ verdict }) => verdict === 'CORRECTED')
        ?.sequence.toString(),
    );
    expect(afterRetry[0].sequence).toBe(fixture.previous.sequence);
    expect(afterRetry.every(({ isGroundTruth }) => !isGroundTruth)).toBe(true);
  });

  it('serializa la verificación individual y la selección concurrentes del mismo correo', async () => {
    const fixture = await createFixture();
    const controller = new AiEvidenceController(
      evidenceService(() => Promise.resolve({ requeued: 0 })),
    );
    const individualRequest = transformedRequest();
    const batchRequest = plainToInstance(CreateReviewSelectionVerificationDto, {
      ...verificationBody,
      messageIds: [fixture.messageId],
    });
    await validateRequest(individualRequest);
    await validateRequest(batchRequest);

    const [individual, batch] = await Promise.all([
      controller.verifyMessage(
        { sub: fixture.userId },
        fixture.messageId,
        individualRequest,
      ),
      controller.verifyReviewSelection({ sub: fixture.userId }, batchRequest),
    ]);
    const afterConcurrent = await messageVerifications(
      fixture.userId,
      fixture.messageId,
    );

    expect(afterConcurrent).toHaveLength(2);
    expect(
      afterConcurrent.filter(({ verdict }) => verdict === 'CORRECTED'),
    ).toHaveLength(1);
    expect(batch.verified + batch.alreadyVerified).toBe(1);
    expect(individual.sequence).toBe(
      afterConcurrent
        .find(({ verdict }) => verdict === 'CORRECTED')
        ?.sequence.toString(),
    );
  });
});
