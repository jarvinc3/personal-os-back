// A real child process is killed by the integration suite while these actual
// application classes are mid-flight. Run after build:packages.
require('reflect-metadata');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { getPrismaClientClass } = require('@personal-os/database');
const {
  DomainEventIdempotencyGuard,
} = require('../../packages/core/dist/events/domain-event-idempotency.guard');
const {
  OutboxRelay,
} = require('../../packages/core/dist/events/outbox/outbox-relay');

const url = new URL(process.env.TEST_DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  throw new Error('Crash tests require an explicit local TEST_DATABASE_URL');
}
const schema = process.env.TEST_DATABASE_SCHEMA;
if (!/^outbox_test_[a-f0-9]+$/.test(schema)) {
  throw new Error('Invalid isolated test schema');
}
const pool = new Pool({ connectionString: url.toString() });
const PrismaClient = getPrismaClientClass();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
const guard = new DomainEventIdempotencyGuard(prisma);
const waitForKill = () => new Promise(() => {});

async function main() {
  const mode = process.argv[2];
  const dispatcher = new OutboxRelay(prisma, {
    emitAsync: async () => {
      if (mode === 'uncommitted') {
        await guard.runOnce('crash-event', 'worker', async (tx) => {
          await tx.notification.create({
            data: {
              userId: 'test-user',
              type: 'test',
              channel: 'IN_APP',
              title: 'test',
              body: 'test',
            },
          });
          process.send('effect-written');
          await waitForKill();
        });
      } else if (mode === 'committed') {
        await guard.runOnce('crash-event', 'worker', (tx) =>
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
        process.send('effect-committed');
        await waitForKill();
      } else {
        throw new Error('Unknown crash mode');
      }
    },
  });
  await dispatcher.processBatch();
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  process.disconnect();
});
