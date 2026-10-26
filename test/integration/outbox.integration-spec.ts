import 'reflect-metadata';
import { fork, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { once } from 'events';
import { join } from 'path';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { Test } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import {
  getPrismaClientClass,
  type PrismaService,
} from '@personal-os/database';
import { AppEvents, DomainEventIdempotencyGuard } from '@personal-os/core';
import {
  NotificationsGateway,
  NotificationsService,
} from '@personal-os/notifications';
// eslint-disable-next-line no-restricted-imports -- Verify the real Nest event decorator and consumer transaction together.
import { NotificationsEventsListener } from '../../packages/notifications/src/application/notifications-events.listener';
// eslint-disable-next-line no-restricted-imports -- Integration exercises the private relay without widening its production barrel.
import { FinanceOutboxDispatcher } from '../../packages/finance/src/events/infrastructure/finance-outbox.dispatcher';

// Fail instead of silently skipping: CI must supply a dedicated local database.
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
const schema = `outbox_test_${randomUUID().replaceAll('-', '')}`;
const pool = new Pool({ connectionString });
const PrismaClient = getPrismaClientClass();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
const guard = new DomainEventIdempotencyGuard(prisma as PrismaService);
const children = new Set<ChildProcess>();

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function dispatcher(emitAsync: () => Promise<unknown>) {
  return new FinanceOutboxDispatcher(
    prisma as PrismaService,
    { emitAsync } as never,
  );
}

async function insertEvent(attempts = 0) {
  return prisma.domainEventOutbox.create({
    data: {
      eventId: 'crash-event',
      eventName: 'test.event',
      aggregateType: 'Test',
      aggregateId: 'test',
      payload: {},
      attempts,
    },
  });
}

function createEffect() {
  return guard.runOnce('crash-event', 'worker', (tx) =>
    tx.notification.create({
      data: {
        userId: 'test-user',
        type: 'test',
        channel: 'IN_APP',
        title: 'test',
        body: 'test',
      },
    }),
  );
}

async function expireLease() {
  await prisma.domainEventOutbox.updateMany({
    data: { claimedAt: new Date(Date.now() - 6 * 60_000) },
  });
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  children.delete(child);
}

async function crashWorker(mode: string, expected: string) {
  const child = fork(join(__dirname, 'outbox-crash.worker.cjs'), [mode], {
    env: {
      ...process.env,
      TEST_DATABASE_URL: connectionString,
      TEST_DATABASE_SCHEMA: schema,
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    execArgv: [],
    windowsHide: true,
  });
  children.add(child);
  await new Promise<void>((resolve, reject) => {
    let errorOutput = '';
    child.stderr?.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });
    const timer = setTimeout(
      () =>
        reject(new Error(`Worker did not reach ${expected}: ${errorOutput}`)),
      10000,
    );
    child.once('message', (message) => {
      clearTimeout(timer);
      if (message === expected) {
        resolve();
      } else {
        reject(new Error(JSON.stringify(message)));
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Worker exited ${code}: ${errorOutput}`));
    });
  });
  await stopChild(child);
}

describe('Outbox recovery with PostgreSQL', () => {
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    // LIKE copies the migrated column types/defaults/unique indexes without
    // foreign keys to unrelated domain fixtures. No production tables mutate.
    for (const table of [
      'domain_event_outbox',
      'processed_domain_events',
      'notifications',
    ]) {
      await pool.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
    // Prisma qualifies enum casts with the adapter schema as well.
    for (const [table, column, type, defaultValue] of [
      ['notifications', 'channel', 'NotificationChannel', null],
      [
        'domain_event_outbox',
        'status',
        'domain_event_outbox_status',
        'PENDING',
      ],
    ]) {
      const labels = await pool.query<{ enumlabel: string }>(
        'SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname=$2 ORDER BY e.enumsortorder',
        ['public', type],
      );
      const values = labels.rows
        .map((row) => `'${row.enumlabel.replaceAll("'", "''")}'`)
        .join(',');
      await pool.query(`CREATE TYPE "${schema}"."${type}" AS ENUM (${values})`);
      await pool.query(
        `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" DROP DEFAULT`,
      );
      await pool.query(
        `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" TYPE "${schema}"."${type}" USING "${column}"::text::"${schema}"."${type}"`,
      );
      if (defaultValue) {
        await pool.query(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" SET DEFAULT '${defaultValue}'`,
        );
      }
    }
  });

  beforeEach(async () => {
    await prisma.notification.deleteMany();
    await prisma.processedDomainEvent.deleteMany();
    await prisma.domainEventOutbox.deleteMany();
  });

  afterEach(async () => {
    await Promise.all([...children].map(stopChild));
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });

  it('rolls back the receipt and effect together, then permits a retry', async () => {
    await expect(
      guard.runOnce('crash-event', 'worker', async (tx) => {
        await tx.notification.create({
          data: {
            userId: 'test-user',
            type: 'test',
            channel: 'IN_APP',
            title: 'test',
            body: 'test',
          },
        });
        throw new Error('after write');
      }),
    ).rejects.toThrow('after write');
    expect(await prisma.processedDomainEvent.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
    await createEffect();
    expect(await prisma.notification.count()).toBe(1);
    expect(await prisma.processedDomainEvent.count()).toBe(1);
  });

  it('serializes concurrent deliveries of the same consumer', async () => {
    await Promise.all([createEffect(), createEffect(), createEffect()]);
    expect(await prisma.notification.count()).toBe(1);
    expect(await prisma.processedDomainEvent.count()).toBe(1);
  });

  it('propagates a Nest listener failure and retries its notification atomically', async () => {
    const create = jest
      .fn()
      .mockImplementation((_userId, dto, tx) =>
        tx.notification.create({ data: { ...dto, userId: 'test-user' } }),
      );
    const publishInApp = jest.fn();
    const module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        NotificationsEventsListener,
        { provide: DomainEventIdempotencyGuard, useValue: guard },
        { provide: NotificationsService, useValue: { create, publishInApp } },
        { provide: NotificationsGateway, useValue: { emitToUser: jest.fn() } },
      ],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const emitter = app.get(EventEmitter2);
      const event = {
        userId: 'test-user',
        eventId: 'budget-event',
        budgetId: 'budget',
        percentageUsed: 90,
      };
      create.mockRejectedValueOnce(new Error('notification write failed'));
      await expect(
        emitter.emitAsync(AppEvents.FINANCE_BUDGET_THRESHOLD_CROSSED, event),
      ).rejects.toThrow('notification write failed');
      expect(await prisma.processedDomainEvent.count()).toBe(0);
      expect(await prisma.notification.count()).toBe(0);
      await emitter.emitAsync(
        AppEvents.FINANCE_BUDGET_THRESHOLD_CROSSED,
        event,
      );
      await emitter.emitAsync(
        AppEvents.FINANCE_BUDGET_THRESHOLD_CROSSED,
        event,
      );
      expect(await prisma.notification.count()).toBe(1);
      expect(await prisma.processedDomainEvent.count()).toBe(1);
      expect(publishInApp).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it.each([false, true])(
    'fences an expired worker when its callback fails=%s',
    async (fails) => {
      await insertEvent();
      const entered = deferred();
      const release = deferred();
      const first = dispatcher(async () => {
        entered.resolve();
        await release.promise;
        if (fails) {
          throw new Error('late worker failure');
        }
      }).processBatch();
      await entered.promise;
      await expireLease();
      await dispatcher(async () => {}).processBatch();
      release.resolve();
      await first;
      const event = await prisma.domainEventOutbox.findFirstOrThrow();
      expect(event).toMatchObject({
        status: 'COMPLETED',
        attempts: 2,
        claimedAt: null,
        lastError: null,
      });
    },
  );

  it('keeps an active lease and sends an exhausted abandoned lease to DEAD', async () => {
    const event = await insertEvent(8);
    await prisma.domainEventOutbox.update({
      where: { id: event.id },
      data: { status: 'PROCESSING', claimedAt: new Date() },
    });
    const emit = jest.fn();
    await dispatcher(emit).processBatch();
    expect((await prisma.domainEventOutbox.findFirstOrThrow()).status).toBe(
      'PROCESSING',
    );
    await expireLease();
    await dispatcher(emit).processBatch();
    expect((await prisma.domainEventOutbox.findFirstOrThrow()).status).toBe(
      'DEAD',
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('recovers rows left PROCESSING by the pre-lease version', async () => {
    const event = await insertEvent(1);
    await prisma.domainEventOutbox.update({
      where: { id: event.id },
      data: { status: 'PROCESSING', claimedAt: null },
    });
    await dispatcher(createEffect).processBatch();
    expect((await prisma.domainEventOutbox.findFirstOrThrow()).status).toBe(
      'COMPLETED',
    );
    expect(await prisma.notification.count()).toBe(1);
  });

  it('recovers after killing a process between the effect write and commit', async () => {
    await insertEvent();
    await crashWorker('uncommitted', 'effect-written');
    await expireLease();
    await dispatcher(createEffect).processBatch();
    expect(await prisma.notification.count()).toBe(1);
    expect(await prisma.processedDomainEvent.count()).toBe(1);
    expect((await prisma.domainEventOutbox.findFirstOrThrow()).status).toBe(
      'COMPLETED',
    );
  });

  it('does not duplicate an effect committed before the worker dies without acknowledging', async () => {
    await insertEvent();
    await crashWorker('committed', 'effect-committed');
    expect(await prisma.notification.count()).toBe(1);
    await expireLease();
    await dispatcher(createEffect).processBatch();
    expect(await prisma.notification.count()).toBe(1);
    expect((await prisma.domainEventOutbox.findFirstOrThrow()).status).toBe(
      'COMPLETED',
    );
  });
});
