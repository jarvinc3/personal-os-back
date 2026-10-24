import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { getPrismaClientClass } from '@personal-os/database';

const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  !['localhost', '127.0.0.1', '[::1]'].includes(
    new URL(connectionString).hostname,
  )
) {
  throw new Error(
    'AI inference integration requires a migrated local TEST_DATABASE_URL',
  );
}

const pool = new Pool({ connectionString });
const PrismaClient = getPrismaClientClass();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const userId = randomUUID();

describe('AI inference telemetry on PostgreSQL', () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@integration.test`,
        fullName: 'AI integration test',
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await pool.end();
  });

  it('persists metadata and cascades telemetry with user deletion', async () => {
    const inference = await prisma.aiInference.create({
      data: {
        userId,
        task: 'integration.test',
        provider: 'test-provider',
        model: 'test-model',
        promptVersion: 'prompt-v1',
        schemaVersion: 'schema-v1',
        inputFingerprint: 'a'.repeat(64),
        fingerprintVersion: 'v1',
        status: 'SUCCEEDED',
        fallbackCount: 0,
        latencyMs: 12,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1_000),
      },
    });
    expect(inference).toMatchObject({
      userId,
      task: 'integration.test',
      status: 'SUCCEEDED',
      inputTokens: null,
      outputTokens: null,
    });

    await prisma.user.delete({ where: { id: userId } });

    await expect(prisma.aiInference.count({ where: { userId } })).resolves.toBe(
      0,
    );
  });
});
