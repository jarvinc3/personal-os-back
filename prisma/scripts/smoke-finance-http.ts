/**
 * HTTP smoke against a running Nest API + real DATABASE_URL.
 *
 * Usage (example):
 *   SMOKE_BASE_URL=http://127.0.0.1:3000/api \
 *   SMOKE_JWT=<supabase-or-dev-jwt> \
 *   pnpm exec ts-node -r tsconfig-paths/register prisma/scripts/smoke-finance-http.ts
 *
 * Requires: app running with FX key, two accounts or ability to create them.
 * Cleans up smoke-tagged rows after verification.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';
import { Pool } from 'pg';
import { getPrismaClientClass } from '../../src/prisma/generated/internal/class';
import {
    defaultRejectUnauthorized,
    poolConfigForPostgresUrl,
} from '../../src/prisma/pg-pool.config';

const BASE = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000/api').replace(
  /\/$/,
  '',
);
const JWT = process.env.SMOKE_JWT;
const TAG = `http-smoke-${Date.now()}`;

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  if (!JWT) throw new Error('SMOKE_JWT is required');
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${JWT}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, data: json.data ?? json };
}

async function main() {
  if (!JWT) {
    console.error('SMOKE_JWT required');
    process.exitCode = 1;
    return;
  }

  const PrismaClient = getPrismaClientClass();
  const pool = new Pool(
    poolConfigForPostgresUrl(process.env.DATABASE_URL!, {
      rejectUnauthorized: defaultRejectUnauthorized(process.env.NODE_ENV, undefined),
      ca: process.env.DATABASE_SSL_CA,
    }),
  );
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const createdAccountIds: string[] = [];
  const createdTxIds: string[] = [];
  let transferGroupId: string | undefined;

  try {
    let accounts = await prisma.finAccount.findMany({
      where: { isActive: true },
      take: 2,
    });

    if (accounts.length < 2) {
      const a1 = await api('POST', '/finance/accounts', {
        name: `${TAG}-from`,
        type: 'CHECKING',
        currency: 'DOP',
      });
      const a2 = await api('POST', '/finance/accounts', {
        name: `${TAG}-to`,
        type: 'SAVINGS',
        currency: 'DOP',
      });
      if (a1.status >= 300 || a2.status >= 300) {
        throw new Error(`account create failed: ${a1.status}/${a2.status}`);
      }
      createdAccountIds.push(a1.data.id, a2.data.id);
      accounts = [a1.data, a2.data] as never;
    }

    const fromId = accounts[0].id as string;
    const toId = accounts[1].id as string;
    console.log(JSON.stringify({ step: 'accounts', fromId, toId }));

    const multi = await api('POST', '/finance/transactions', {
      type: 'DEBIT',
      amount: 2.5,
      currency: 'USD',
      transactionDate: new Date().toISOString(),
      accountId: fromId,
      merchant: TAG,
      description: `${TAG} multi-currency`,
    });
    console.log(JSON.stringify({ step: 'multi_fx', status: multi.status, id: multi.data?.id, ledgerAmount: multi.data?.ledgerAmount, currency: multi.data?.currency }));
    if (multi.status >= 300) throw new Error(`multi fx failed: ${JSON.stringify(multi)}`);
    createdTxIds.push(multi.data.id);

    const pending = await api('POST', '/finance/transactions', {
      type: 'DEBIT',
      amount: 5,
      currency: 'DOP',
      transactionDate: new Date().toISOString(),
      accountId: fromId,
      status: 'PENDING',
      merchant: TAG,
      description: `${TAG} pending`,
    });
    console.log(JSON.stringify({ step: 'pending', status: pending.status, id: pending.data?.id }));
    if (pending.status >= 300) throw new Error(`pending create failed`);
    createdTxIds.push(pending.data.id);

    const confirmed = await api(
      'POST',
      `/finance/transactions/${pending.data.id}/confirm`,
    );
    console.log(JSON.stringify({ step: 'confirm', status: confirmed.status, txStatus: confirmed.data?.status }));
    if (confirmed.status >= 300) throw new Error(`confirm failed`);

    const transfer = await api('POST', '/finance/transfers', {
      fromAccountId: fromId,
      toAccountId: toId,
      amount: 7,
      currency: 'DOP',
      transactionDate: new Date().toISOString(),
      description: `${TAG} transfer`,
    });
    console.log(JSON.stringify({
      step: 'transfer',
      status: transfer.status,
      group: transfer.data?.transferGroupId,
    }));
    if (transfer.status >= 300) throw new Error(`transfer failed`);
    transferGroupId = transfer.data.transferGroupId;
    if (transfer.data?.debit?.id) createdTxIds.push(transfer.data.debit.id);
    if (transfer.data?.credit?.id) createdTxIds.push(transfer.data.credit.id);

    // wait for outbox wake / cron
    await new Promise((r) => setTimeout(r, 2000));

    const outbox = await prisma.domainEventOutbox.findMany({
      where: {
        aggregateId: {
          in: [...createdTxIds, transferGroupId].filter(Boolean) as string[],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    console.log(JSON.stringify({
      step: 'outbox',
      count: outbox.length,
      rows: outbox.map((o) => ({
        eventName: o.eventName,
        status: o.status,
        aggregateId: o.aggregateId,
      })),
    }));

    const hasConfirmed = outbox.some((o) =>
      o.eventName.includes('finance.transaction'),
    );
    const hasTransfer = outbox.some(
      (o) => o.eventName === 'finance.transfer.created',
    );
    if (!hasConfirmed || !hasTransfer) {
      throw new Error('expected outbox finance events missing');
    }

    console.log(JSON.stringify({ SMOKE_RESULT: 'PASS' }));
  } catch (err) {
    console.error('SMOKE_ERROR', err);
    process.exitCode = 1;
  } finally {
    try {
      if (createdTxIds.length) {
        await prisma.finTransaction.updateMany({
          where: { id: { in: createdTxIds } },
          data: { linkedTransactionId: null },
        });
        await prisma.domainEventOutbox.deleteMany({
          where: { aggregateId: { in: createdTxIds } },
        });
        if (transferGroupId) {
          await prisma.domainEventOutbox.deleteMany({
            where: { aggregateId: transferGroupId },
          });
          await prisma.finTransaction.deleteMany({
            where: { transferGroupId },
          });
        }
        await prisma.finTransaction.deleteMany({
          where: { id: { in: createdTxIds } },
        });
      }
      if (createdAccountIds.length) {
        await prisma.finAccount.deleteMany({
          where: { id: { in: createdAccountIds } },
        });
      }
      console.log(JSON.stringify({ step: 'cleanup', tx: createdTxIds.length, accounts: createdAccountIds.length }));
    } catch (cleanupErr) {
      console.error('CLEANUP_ERROR', cleanupErr);
    }
    await prisma.$disconnect();
    await pool.end();
  }
}

void main();
