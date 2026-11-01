import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  getPrismaClientClass,
  type PrismaService,
} from '@personal-os/database';
// eslint-disable-next-line no-restricted-imports -- The integration test drives the repository against a real database.
import { CatalogRepository } from '../../packages/finance/src/catalog/infrastructure/catalog.repository';

const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  !['localhost', '127.0.0.1', '[::1]'].includes(
    new URL(connectionString).hostname,
  )
) {
  throw new Error(
    'test:integration requires a migrated local TEST_DATABASE_URL',
  );
}

const pool = new Pool({ connectionString });
const PrismaClient = getPrismaClientClass();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const repo = new CatalogRepository(prisma as PrismaService, {} as never);

let userId = '';
let institutionId = '';

const cashInput = () => ({
  institutionId,
  name: 'Efectivo',
  currency: 'DOP',
});

function countCashAccounts(): Promise<number> {
  return prisma.finAccount.count({ where: { userId, type: 'CASH' } });
}

describe('EnsureCashInstitution concurrency', () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `cash-${randomUUID()}@example.test`,
        fullName: 'Cash concurrency test',
      },
      select: { id: true },
    });
    userId = user.id;
    const institution = await prisma.finInstitution.create({
      data: {
        userId,
        name: 'Efectivo',
        type: 'cash',
        isSystem: true,
      },
      select: { id: true },
    });
    institutionId = institution.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await pool.end();
  });

  it('waits for the institution lock and re-checks before creating', async () => {
    const locker = await pool.connect();
    let committed = false;
    try {
      await locker.query('BEGIN');
      await locker.query(
        'SELECT id FROM fin_institutions WHERE id = $1 FOR UPDATE',
        [institutionId],
      );

      let settled = false;
      const pending = repo.ensureCashAccount(userId, cashInput()).then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(settled).toBe(false);

      await locker.query(
        `INSERT INTO fin_accounts (user_id, institution_id, name, type, currency)
         VALUES ($1, $2, $3, $4::"FinAccountType", $5)`,
        [userId, institutionId, 'Efectivo', 'CASH', 'DOP'],
      );
      await locker.query('COMMIT');
      committed = true;

      await pending;
      await expect(countCashAccounts()).resolves.toBe(1);
    } finally {
      if (!committed) {
        await locker.query('ROLLBACK');
      }
      locker.release();
    }
  });

  it('keeps the existing cash account on a later read', async () => {
    await repo.ensureCashAccount(userId, cashInput());

    await expect(countCashAccounts()).resolves.toBe(1);
  });
});
