import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  getPrismaClientClass,
  type PrismaService,
} from '@personal-os/database';
import type { SampleImportManifest } from '@personal-os/intelligence';
import {
  createBhdImportHarness,
  SYNTHETIC_USD_RATE,
  type BhdEmailFixture,
  type BhdImportHarness,
  type BhdUser,
} from './helpers/bhd-import.harness';

const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  !['localhost', '127.0.0.1', '[::1]'].includes(
    new URL(connectionString).hostname,
  )
) {
  throw new Error(
    'Pilot import integration tests require a local TEST_DATABASE_URL',
  );
}

const pool = new Pool({ connectionString, max: 4 });
const PrismaClient = getPrismaClientClass();
const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
}) as PrismaService;
const harness: BhdImportHarness = createBhdImportHarness(prisma);

type PilotExpected = {
  fixedFormat: boolean;
  semanticType?: string;
  movementClass?: string;
  direction?: string;
  amount?: number;
  currency?: string;
  transactionDate?: string;
  last4?: string;
  merchant?: string;
};

type PilotEmail = BhdEmailFixture & { expected: PilotExpected };

type ExpectedImport = readonly [
  prefix: string,
  outcome: string,
  reason?: string,
];

/**
 * Resultado de importación fijado para la muestra saneada del piloto. El
 * fixture repite el mismo número de confirmación en sus tres transferencias
 * entre productos, así que la segunda y la tercera quedan en conflicto de
 * referencia; en el piloto real cada una traía su propia referencia.
 */
const EXPECTED_IMPORT: readonly ExpectedImport[] = [
  ['7e97abf8', 'APPLIED'],
  ['5314c7e3', 'REJECTED', 'NO_TRANSACTION_CANDIDATE'],
  ['862ea155', 'APPLIED'],
  ['603b46fe', 'APPLIED'],
  ['f7f20f1c', 'REVIEW_REQUIRED', 'REVERSAL_ORIGINAL_NOT_FOUND'],
  ['5d906c05', 'APPLIED'],
  ['62cef65f', 'APPLIED'],
  ['2bc6e0c8', 'REJECTED', 'INFERENCE_PROVIDER_FAILURE'],
  ['6df13156', 'APPLIED'],
  ['971a50df', 'APPLIED'],
  ['f2e3f931', 'APPLIED'],
  ['ba29c1a4', 'APPLIED'],
  ['c20448bf', 'APPLIED'],
  ['b2348da0', 'REVIEW_REQUIRED', 'TRANSFER_REFERENCE_CONFLICT'],
  ['82f7524f', 'APPLIED'],
  ['64e73dbf', 'REVIEW_REQUIRED', 'TRANSFER_REFERENCE_CONFLICT'],
  ['03ab866f', 'APPLIED'],
  ['4f327e5e', 'APPLIED'],
  ['896716d6', 'APPLIED'],
  ['b7ff6a79', 'APPLIED'],
];

const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      '../../packages/intelligence/test/fixtures/bhd-emails/pilot-v6-20.json',
    ),
    'utf8',
  ),
) as { emails: PilotEmail[] };

const userIds: string[] = [];
let user: BhdUser;
const messageIds: string[] = [];

beforeAll(async () => {
  user = await harness.createUser('piloto-20');
  userIds.push(user.userId);
  // El único correo fuera de los formatos fijos del piloto falló en el
  // proveedor de inferencia; la muestra reproduce ese fallo.
  harness.failModelInference();
  for (const email of fixture.emails) {
    messageIds.push(await harness.createMessage(user, email));
  }
});

afterAll(async () => {
  await harness.deleteUsers(userIds);
  await prisma.$disconnect();
  await pool.end();
});

function runSample(): Promise<SampleImportManifest> {
  return harness.service.run({
    userId: user.userId,
    dryRun: false,
    selection: { messageIds },
  });
}

function expectedImport(email: PilotEmail) {
  const matches = EXPECTED_IMPORT.filter(([prefix]) =>
    email.messageId.startsWith(prefix),
  );
  if (matches.length !== 1) {
    throw new Error(
      `El correo ${email.messageId} no tiene un resultado fijado`,
    );
  }
  const [, outcome, reason] = matches[0];
  return reason ? { outcome, reason } : { outcome };
}

function expectedReplayImport(email: PilotEmail) {
  const expected = expectedImport(email);
  // El reverso f7f20f1c entra en revisión y lo aplica el reintento cuando se
  // importa su compra en la misma corrida; la segunda vez ya está aplicado.
  const appliedInFirstRun =
    expected.outcome === 'APPLIED' || email.messageId.startsWith('f7f20f1c');
  return appliedInFirstRun ? { outcome: 'ALREADY_APPLIED' } : expected;
}

function describeExecution(
  email: PilotEmail,
  item: SampleImportManifest['items'][number],
) {
  return {
    email: email.messageId,
    outcome: item.execution?.outcome,
    reason: item.execution?.reason,
    hasTransaction: typeof item.execution?.transactionId === 'string',
  };
}

function expectedExecution(
  email: PilotEmail,
  outcome: string,
  reason?: string,
) {
  return {
    email: email.messageId,
    outcome,
    reason,
    hasTransaction: outcome === 'APPLIED' || outcome === 'ALREADY_APPLIED',
  };
}

function expectOutcomes(manifest: SampleImportManifest) {
  expect(manifest.items).toHaveLength(fixture.emails.length);
  expect(
    manifest.items.map((item, index) =>
      describeExecution(fixture.emails[index], item),
    ),
  ).toEqual(
    fixture.emails.map((email) => {
      const expected = expectedImport(email);
      return expectedExecution(email, expected.outcome, expected.reason);
    }),
  );
}

function expectClassificationMatchesFixture(manifest: SampleImportManifest) {
  expect(manifest.items).toHaveLength(fixture.emails.length);
  manifest.items.forEach((item, index) => {
    const email = fixture.emails[index];
    if (!email.expected.fixedFormat) {
      expect(item).toMatchObject({
        classification: null,
        classificationUnavailableReason: 'INFERENCE_PROVIDER_FAILURE',
        signal: { published: false, reason: 'CLASSIFICATION_UNAVAILABLE' },
      });
      return;
    }
    expect(item.classification).toMatchObject({
      semanticType: email.expected.semanticType,
    });
    if (email.expected.semanticType === 'FIN_STATEMENT_NOTICE') {
      expect(item.signal).toEqual({
        published: false,
        reason: 'NO_TRANSACTION_CANDIDATE',
      });
      expect(item.classification?.movementClass).toBeNull();
      return;
    }
    expect(item.signal).toEqual({ published: true });
    expect(item.classification).toMatchObject({
      movementClass: email.expected.movementClass,
      direction: email.expected.direction,
      amount: email.expected.amount,
      currency: email.expected.currency,
      transactionDate: email.expected.transactionDate,
    });
    if (email.expected.last4) {
      expect(item.hints?.last4).toBe(email.expected.last4);
    }
  });
}

function purchaseEmails(): PilotEmail[] {
  return fixture.emails.filter(
    (email) =>
      email.expected.movementClass === 'PURCHASE' &&
      email.expected.amount !== undefined,
  );
}

function appliedEmails(): PilotEmail[] {
  return fixture.emails.filter(
    (email) => expectedImport(email).outcome === 'APPLIED',
  );
}

function refundEmail(): PilotEmail {
  const email = fixture.emails.find((candidate) =>
    candidate.messageId.startsWith('f7f20f1c'),
  );
  if (!email) {
    throw new Error('La muestra del piloto no trae su reverso');
  }
  return email;
}

function expectedCardDebt(): number {
  const total = purchaseEmails().reduce(
    (sum, email) =>
      sum +
      (email.expected.currency === 'USD'
        ? (email.expected.amount ?? 0) * SYNTHETIC_USD_RATE
        : (email.expected.amount ?? 0)),
    0,
  );
  // La compra del reverso se compensa en la misma corrida.
  return total - (refundEmail().expected.amount ?? 0);
}

function cardBalance() {
  return prisma.finCardBalance.findFirstOrThrow({
    where: { cardId: user.cardId, currency: 'DOP' },
    select: { balance: true },
  });
}

describe('Piloto BHD v6: importación de la muestra de 20 correos', () => {
  it('importa la muestra y repetirla no duplica movimientos ni señales', async () => {
    const first = await runSample();

    expectOutcomes(first);
    expectClassificationMatchesFixture(first);

    const rows = await prisma.finTransaction.findMany({
      where: { userId: user.userId },
      orderBy: { transactionDate: 'asc' },
    });
    expect(rows).toHaveLength(appliedEmails().length);
    const purchaseRows = rows.filter((row) => row.legRole === null);
    expect(purchaseRows).toHaveLength(purchaseEmails().length);
    expect(purchaseRows.every((row) => row.type === 'DEBIT')).toBe(true);
    expect(purchaseRows.every((row) => row.cardId === user.cardId)).toBe(true);
    const usdPurchases = purchaseRows.filter((row) => row.currency === 'USD');
    expect(usdPurchases).toHaveLength(2);
    for (const row of usdPurchases) {
      expect(row.ledgerCurrency).toBe('DOP');
      expect(row.exchangeRate.toString()).toBe(String(SYNTHETIC_USD_RATE));
      expect(Number(row.ledgerAmount).toFixed(2)).toBe(
        (Number(row.amount) * SYNTHETIC_USD_RATE).toFixed(2),
      );
    }

    const refundedPurchase = purchaseRows.find(
      (row) => row.status === 'REVERSED',
    );
    expect(refundedPurchase?.amount.toString()).toBe(
      refundEmail().expected.amount?.toFixed(2),
    );
    expect(refundedPurchase?.currency).toBe('DOP');
    const refundMessageId =
      messageIds[fixture.emails.indexOf(refundEmail())] ?? '';
    const refundImport = await prisma.finSignalImport.findFirstOrThrow({
      where: {
        userId: user.userId,
        sourceEmailMessageId: refundMessageId,
      },
      select: { transactionId: true },
    });
    expect(refundImport.transactionId).toBe(refundedPurchase?.id);

    const transferLegs = rows.filter((row) => row.legRole !== null);
    expect(transferLegs).toHaveLength(3);
    const groups = new Map<string, typeof transferLegs>();
    for (const leg of transferLegs) {
      if (!leg.transferGroupId) {
        throw new Error('La pata de transferencia no tiene grupo');
      }
      groups.set(leg.transferGroupId, [
        ...(groups.get(leg.transferGroupId) ?? []),
        leg,
      ]);
    }
    const pairedGroups = [...groups.values()].filter(
      (group) => group.length === 2,
    );
    expect(pairedGroups).toHaveLength(1);
    expect(pairedGroups[0].map((leg) => leg.legRole).sort()).toEqual([
      'DESTINATION',
      'SOURCE',
    ]);
    expect(pairedGroups[0].every((leg) => leg.status === 'PENDING')).toBe(true);
    expect(
      [...groups.values()].filter((group) => group.length === 1),
    ).toHaveLength(1);

    expect((await cardBalance()).balance.toString()).toBe(
      `-${expectedCardDebt().toFixed(2)}`,
    );
    const signals = await prisma.aiSignal.findMany({
      where: { userId: user.userId },
      select: { sourceId: true },
    });
    const expectedSignals = fixture.emails.filter(
      (email) =>
        email.expected.fixedFormat &&
        email.expected.semanticType === 'FIN_TRANSACTION',
    ).length;
    expect(signals).toHaveLength(expectedSignals);
    expect(new Set(signals.map((signal) => signal.sourceId)).size).toBe(
      expectedSignals,
    );

    const second = await runSample();
    expect(
      second.items.map((item, index) =>
        describeExecution(fixture.emails[index], item),
      ),
    ).toEqual(
      fixture.emails.map((email) => {
        const expected = expectedReplayImport(email);
        return expectedExecution(email, expected.outcome, expected.reason);
      }),
    );
    await expect(
      prisma.finTransaction.count({ where: { userId: user.userId } }),
    ).resolves.toBe(appliedEmails().length);
    await expect(
      prisma.finSignalImport.count({ where: { userId: user.userId } }),
    ).resolves.toBe(expectedSignals);
    expect((await cardBalance()).balance.toString()).toBe(
      `-${expectedCardDebt().toFixed(2)}`,
    );
  });
});
