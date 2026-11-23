import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  getPrismaClientClass,
  type PrismaService,
} from '@personal-os/database';
import type {
  SampleImportManifest,
  SampleManifestItem,
} from '@personal-os/intelligence';
import {
  createBhdImportHarness,
  type BhdEmailFixture,
  type BhdImportHarness,
  type BhdUser,
} from './helpers/bhd-import.harness';
import {
  cardAlertEmail,
  CTR02_SPEC,
  CTR02_TEST_TITLE,
  incomingTransferEmail,
  ownProductsTransferEmail,
  QA19_CASES,
  QA19_MATRIX_SPEC,
  serviceEmail,
  statementNoticeEmail,
} from './fixtures/qa19-bhd/qa19-matrix';

const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  !['localhost', '127.0.0.1', '[::1]'].includes(
    new URL(connectionString).hostname,
  )
) {
  throw new Error('QA19 integration tests require a local TEST_DATABASE_URL');
}

const pool = new Pool({ connectionString, max: 4 });
const PrismaClient = getPrismaClientClass();
const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
}) as PrismaService;
const harness: BhdImportHarness = createBhdImportHarness(prisma);
const createdUserIds = new Set<string>();
const executedCaseIds = new Set<string>();

async function createUser(suffix: string): Promise<BhdUser> {
  const user = await harness.createUser(suffix);
  createdUserIds.add(user.userId);
  return user;
}

async function importEmails({
  user,
  emails,
  modelResponse,
}: {
  user: BhdUser;
  emails: readonly BhdEmailFixture[];
  modelResponse?: 'failure' | Record<string, unknown>;
}): Promise<{ manifest: SampleImportManifest; messageIds: string[] }> {
  const messageIds: string[] = [];
  for (const email of emails) {
    messageIds.push(await harness.createMessage(user, email));
  }
  if (modelResponse === 'failure') {
    harness.failModelInference();
  } else if (modelResponse !== undefined) {
    harness.setModelResponse(modelResponse);
  } else {
    harness.clearModelResponse();
  }
  const manifest = await harness.service.run({
    userId: user.userId,
    dryRun: false,
    selection: { messageIds },
  });
  return { manifest, messageIds };
}

function transactionRows(userId: string) {
  return prisma.finTransaction.findMany({
    where: { userId },
    orderBy: { transactionDate: 'asc' },
  });
}

function readImport(userId: string, messageId: string) {
  return prisma.finSignalImport.findUnique({
    where: { userId_signalId: { userId, signalId: `email-${messageId}` } },
  });
}

function expectOutcome(
  item: SampleManifestItem,
  expected: { outcome: string; reason?: string },
) {
  expect(item.execution).toMatchObject(expected);
}

function expectClassification(
  item: SampleManifestItem,
  expected: Record<string, unknown>,
) {
  expect(item.classification).toMatchObject(expected);
}

function createPriorTransaction({
  user,
  type,
  amount,
  transactionDate,
  externalReference,
  cardId,
  accountId,
  transferGroupId,
  status = 'CONFIRMED',
}: {
  user: BhdUser;
  type: 'DEBIT' | 'CREDIT';
  amount: number;
  transactionDate: string;
  externalReference?: string;
  cardId?: string;
  accountId?: string;
  transferGroupId?: string;
  status?: 'CONFIRMED' | 'PENDING';
}) {
  return prisma.finTransaction.create({
    data: {
      id: randomUUID(),
      userId: user.userId,
      institutionId: user.institutionId,
      accountId: accountId ?? null,
      cardId: cardId ?? null,
      type,
      amount,
      ledgerAmount: amount,
      amountBaseCurrency: amount,
      currency: 'DOP',
      ledgerCurrency: 'DOP',
      exchangeRate: 1,
      transactionDate: new Date(transactionDate),
      description: 'Movimiento sintético previo de la matriz QA19',
      source: 'EMAIL',
      status,
      externalReference: externalReference ?? null,
      transferGroupId: transferGroupId ?? null,
      legRole: transferGroupId ? 'SOURCE' : null,
    },
  });
}

afterAll(async () => {
  const now = new Date();
  await prisma.aiEmailDailyCost.deleteMany({
    where: {
      date: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      ),
    },
  });
  await harness.deleteUsers([...createdUserIds]);
  await prisma.$disconnect();
  await pool.end();
});

describe('Matriz QA19 BHD con datos sintéticos', () => {
  it('QA19-TRA-01 registra la transferencia recibida en la cuenta propia', async () => {
    executedCaseIds.add('QA19-TRA-01');
    const user = await createUser('tra-01');
    const { manifest } = await importEmails({
      user,
      emails: [
        incomingTransferEmail({
          messageId: 'qa19-tra-01',
          transactionDate: '2031-05-01T16:47:00.000Z',
          amount: '500.00',
        }),
      ],
    });

    expectOutcome(manifest.items[0], { outcome: 'APPLIED' });
    expectClassification(manifest.items[0], {
      semanticType: 'FIN_TRANSACTION',
      movementClass: 'TRANSFER_IN',
      direction: 'TRANSFER',
      amount: 500,
      currency: 'DOP',
      transactionDate: '2031-05-01T16:47:00.000Z',
    });
    const rows = await transactionRows(user.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'CREDIT',
      legRole: 'DESTINATION',
      status: 'PENDING',
      accountId: user.savingsAccountId,
      cardId: null,
      externalReference: null,
      linkedTransactionId: null,
    });
    expect(rows[0].amount.toString()).toBe('500');
    expect(rows[0].transferGroupId).not.toBeNull();
  });

  it('QA19-TRA-02 registra solo la pata de salida de una transferencia entre productos', async () => {
    executedCaseIds.add('QA19-TRA-02');
    const user = await createUser('tra-02');
    const { manifest } = await importEmails({
      user,
      emails: [
        ownProductsTransferEmail({
          messageId: 'qa19-tra-02',
          transactionDate: '2031-05-02T15:12:00.000Z',
          originLast4: '1111',
          destinationLast4: '2222',
          amount: '757.62',
          reference: 'M01-QA19-02',
        }),
      ],
    });

    expectOutcome(manifest.items[0], { outcome: 'APPLIED' });
    expectClassification(manifest.items[0], {
      movementClass: 'TRANSFER_OUT',
      direction: 'TRANSFER',
      amount: 757.62,
      currency: 'DOP',
      transactionDate: '2031-05-02T15:12:00.000Z',
    });
    const rows = await transactionRows(user.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'DEBIT',
      legRole: 'SOURCE',
      status: 'PENDING',
      accountId: user.savingsAccountId,
      cardId: null,
      externalReference: 'M01-QA19-02',
      linkedTransactionId: null,
    });
    expect(rows[0].description).toBe('FIN_TRANSACTION');
    expect(rows[0].transferGroupId).not.toBeNull();
  });

  it('QA19-TRA-03 empareja los dos avisos de la misma transferencia sin duplicar', async () => {
    executedCaseIds.add('QA19-TRA-03');
    const user = await createUser('tra-03');
    const { manifest, messageIds } = await importEmails({
      user,
      emails: [
        incomingTransferEmail({
          messageId: 'qa19-tra-03-recibida',
          transactionDate: '2031-05-03T15:16:00.000Z',
          amount: '1000.00',
        }),
        ownProductsTransferEmail({
          messageId: 'qa19-tra-03-enviada',
          transactionDate: '2031-05-03T15:18:00.000Z',
          originLast4: '1111',
          destinationLast4: '2222',
          amount: '1000.00',
          reference: 'M01-QA19-03',
        }),
      ],
    });

    expect(manifest.items.map((item) => item.execution?.outcome)).toEqual([
      'APPLIED',
      'APPLIED',
    ]);
    const rows = await transactionRows(user.userId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.type).sort()).toEqual(['CREDIT', 'DEBIT']);
    expect(rows[0].transferGroupId).not.toBeNull();
    expect(rows[1].transferGroupId).toBe(rows[0].transferGroupId);
    expect(rows.map((row) => row.legRole).sort()).toEqual([
      'DESTINATION',
      'SOURCE',
    ]);
    for (const messageId of messageIds) {
      const imported = await readImport(user.userId, messageId);
      expect(imported?.status).toBe('IMPORTED');
    }
  });

  it('QA19-TRA-04 deja en revisión una transferencia con cuenta desconocida', async () => {
    executedCaseIds.add('QA19-TRA-04');
    const user = await createUser('tra-04');
    const { manifest, messageIds } = await importEmails({
      user,
      emails: [
        ownProductsTransferEmail({
          messageId: 'qa19-tra-04',
          transactionDate: '2031-05-04T15:12:00.000Z',
          originLast4: '9999',
          destinationLast4: '2222',
          amount: '300.00',
          reference: 'M01-QA19-04',
        }),
      ],
    });

    expect(manifest.items[0].signal).toEqual({ published: true });
    expectOutcome(manifest.items[0], {
      outcome: 'REVIEW_REQUIRED',
      reason: 'TRANSFER_ACCOUNT_NOT_FOUND',
    });
    await expect(transactionRows(user.userId)).resolves.toHaveLength(0);
    const imported = await readImport(user.userId, messageIds[0]);
    expect(imported).toMatchObject({
      status: 'REVIEW_REQUIRED',
      reviewReason: 'TRANSFER_ACCOUNT_NOT_FOUND',
      transactionId: null,
    });
  });

  it('QA19-COM-01 registra la compra en la tarjeta propia', async () => {
    executedCaseIds.add('QA19-COM-01');
    const user = await createUser('com-01');
    const { manifest } = await importEmails({
      user,
      emails: [
        cardAlertEmail({
          messageId: 'qa19-com-01',
          transactionDate: '2031-05-06T18:05:00.000Z',
          amount: '59.99',
          currency: 'DOP',
          merchant: 'COMERCIO SINTÉTICO UNO',
        }),
      ],
    });

    expectOutcome(manifest.items[0], { outcome: 'APPLIED' });
    expectClassification(manifest.items[0], {
      movementClass: 'PURCHASE',
      direction: 'DEBIT',
      amount: 59.99,
      currency: 'DOP',
    });
    expect(manifest.items[0].hints?.last4).toBe('1111');
    const rows = await transactionRows(user.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'DEBIT',
      status: 'CONFIRMED',
      cardId: user.cardId,
      accountId: null,
      categoryId: null,
      description: 'COMERCIO SINTÉTICO UNO',
    });
    expect(rows[0].amount.toString()).toBe('59.99');
    const cardBalance = await prisma.finCardBalance.findFirstOrThrow({
      where: { cardId: user.cardId, currency: 'DOP' },
      select: { balance: true },
    });
    expect(cardBalance.balance.toString()).toBe('-59.99');
  });

  it('QA19-COM-02 convierte la compra en dólares con la tasa del ledger', async () => {
    executedCaseIds.add('QA19-COM-02');
    const user = await createUser('com-02');
    const { manifest } = await importEmails({
      user,
      emails: [
        cardAlertEmail({
          messageId: 'qa19-com-02',
          transactionDate: '2031-05-07T13:20:00.000Z',
          amount: '29.99',
          currency: 'USD',
          merchant: 'COMERCIO SINTÉTICO DOS',
        }),
      ],
    });

    expectOutcome(manifest.items[0], { outcome: 'APPLIED' });
    expectClassification(manifest.items[0], {
      movementClass: 'PURCHASE',
      amount: 29.99,
      currency: 'USD',
    });
    const rows = await transactionRows(user.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount.toString()).toBe('29.99');
    expect(rows[0].currency).toBe('USD');
    expect(rows[0].ledgerAmount.toString()).toBe('1799.4');
    expect(rows[0].ledgerCurrency).toBe('DOP');
    expect(rows[0].amountBaseCurrency.toString()).toBe('1799.4');
    expect(rows[0].exchangeRate.toString()).toBe('60');
  });

  it('QA19-COM-03 deja en revisión la compra con tarjeta desconocida', async () => {
    executedCaseIds.add('QA19-COM-03');
    const user = await createUser('com-03');
    const { manifest } = await importEmails({
      user,
      emails: [
        cardAlertEmail({
          messageId: 'qa19-com-03',
          transactionDate: '2031-05-08T14:00:00.000Z',
          amount: '100.00',
          currency: 'DOP',
          cardLast4: '4444',
        }),
      ],
    });

    expectOutcome(manifest.items[0], {
      outcome: 'REVIEW_REQUIRED',
      reason: 'NO_LEDGER_TARGET',
    });
    await expect(transactionRows(user.userId)).resolves.toHaveLength(0);
  });

  it('QA19-COM-04 registra la compra sin comercio con el texto de relleno', async () => {
    executedCaseIds.add('QA19-COM-04');
    const user = await createUser('com-04');
    const { manifest } = await importEmails({
      user,
      emails: [
        cardAlertEmail({
          messageId: 'qa19-com-04',
          transactionDate: '2031-05-09T17:30:00.000Z',
          amount: '88.00',
          currency: 'DOP',
          merchant: null,
        }),
      ],
    });

    expectOutcome(manifest.items[0], { outcome: 'APPLIED' });
    const rows = await transactionRows(user.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'DEBIT',
      merchant: 'Comercio desconocido',
    });
    expect(rows[0].aiMetadata).toMatchObject({ merchantMissing: true });
  });

  it('QA19-PAG-01 registra el pago de tarjeta confirmado como la operación de dos patas', async () => {
    executedCaseIds.add('QA19-PAG-01');
    const user = await createUser('pag-01');
    const { manifest } = await importEmails({
      user,
      modelResponse: {
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        confidence: 0.95,
        transaction: {
          kind: 'TRANSACTION',
          amount: 2500,
          currency: 'DOP',
          transactionDate: '2031-05-10T15:00:00.000Z',
          direction: 'DEBIT',
          movementClass: 'CARD_PAYMENT',
          last4: '1111',
          accountNumberLast4: '1111',
          bankStatusNormalized: 'COMPLETED',
          statusConfidence: 0.95,
        },
      },
      emails: [
        serviceEmail({
          messageId: 'qa19-pag-01',
          subject: 'Pago de tarjeta confirmado',
          text: 'Pago de tarjeta confirmado por RD$2,500.00. Fecha y hora de la transacción: 10/05/2031 - 11:00 AM.',
          receivedAt: '2031-05-10T15:02:00.000Z',
        }),
      ],
    });

    expectOutcome(manifest.items[0], { outcome: 'APPLIED' });
    expectClassification(manifest.items[0], {
      movementClass: 'CARD_PAYMENT',
      direction: 'DEBIT',
      amount: 2500,
      currency: 'DOP',
    });
    const rows = await transactionRows(user.userId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.type)).toEqual([
      'CARD_PAYMENT',
      'CARD_PAYMENT',
    ]);
    expect(rows.map((row) => row.legRole).sort()).toEqual([
      'DESTINATION',
      'SOURCE',
    ]);
    expect(rows[0].transferGroupId).not.toBeNull();
    expect(rows[1].transferGroupId).toBe(rows[0].transferGroupId);
    expect(rows.map((row) => row.categoryId)).toEqual([null, null]);
    const account = await prisma.finAccount.findUniqueOrThrow({
      where: { id: user.savingsAccountId },
      select: { balance: true },
    });
    expect(account.balance.toString()).toBe('7500');
    const cardBalance = await prisma.finCardBalance.findFirstOrThrow({
      where: { cardId: user.cardId, currency: 'DOP' },
      select: { balance: true },
    });
    expect(cardBalance.balance.toString()).toBe('2500');
  });

  it('QA19-PAG-02 no registra un pago de tarjeta que el correo no confirma', async () => {
    executedCaseIds.add('QA19-PAG-02');
    const user = await createUser('pag-02');
    const { manifest, messageIds } = await importEmails({
      user,
      emails: [
        ownProductsTransferEmail({
          messageId: 'qa19-pag-02',
          transactionDate: '2031-05-10T18:00:00.000Z',
          originLast4: '1111',
          destinationLast4: '1111',
          amount: '800.00',
          reference: 'M01-QA19-11',
        }),
      ],
    });

    expectOutcome(manifest.items[0], {
      outcome: 'REVIEW_REQUIRED',
      reason: 'CARD_PAYMENT_NOT_CONFIRMED',
    });
    await expect(transactionRows(user.userId)).resolves.toHaveLength(0);
    const imported = await readImport(user.userId, messageIds[0]);
    expect(imported).toMatchObject({
      status: 'REVIEW_REQUIRED',
      reviewReason: 'CARD_PAYMENT_NOT_CONFIRMED',
    });
  });

  it('QA19-DAT-01 no crea movimiento con un aviso de estado de cuenta', async () => {
    executedCaseIds.add('QA19-DAT-01');
    const user = await createUser('dat-01');
    const { manifest } = await importEmails({
      user,
      emails: [
        statementNoticeEmail({
          messageId: 'qa19-dat-01',
          month: 'abril de 2031',
          receivedAt: '2031-05-11T12:00:00.000Z',
        }),
      ],
    });

    expect(manifest.items[0].signal).toEqual({
      published: false,
      reason: 'NO_TRANSACTION_CANDIDATE',
    });
    expectOutcome(manifest.items[0], {
      outcome: 'REJECTED',
      reason: 'NO_TRANSACTION_CANDIDATE',
    });
    await expect(transactionRows(user.userId)).resolves.toHaveLength(0);
  });

  it('QA19-DAT-02 no confunde un correo sin transacción con un fallo de clasificación', async () => {
    executedCaseIds.add('QA19-DAT-02');
    const user = await createUser('dat-02');
    const { manifest } = await importEmails({
      user,
      modelResponse: {
        relevance: true,
        semanticType: 'MARKETING',
        routes: [],
        confidence: 0.9,
      },
      emails: [
        serviceEmail({
          messageId: 'qa19-dat-02',
          subject: 'Beneficios de tu tarjeta BHD',
          text: 'Descubre los beneficios y promociones de tu tarjeta.',
          receivedAt: '2031-05-12T12:00:00.000Z',
        }),
      ],
    });

    expect(manifest.items[0].classificationUnavailableReason).toBeUndefined();
    expectClassification(manifest.items[0], { semanticType: 'MARKETING' });
    expectOutcome(manifest.items[0], {
      outcome: 'REJECTED',
      reason: 'NO_TRANSACTION_CANDIDATE',
    });
    const message = await prisma.aiEmailMessage.findFirstOrThrow({
      where: { userId: user.userId },
      select: { processingStatus: true },
    });
    expect(message.processingStatus).toBe('PROCESSED');
    await expect(transactionRows(user.userId)).resolves.toHaveLength(0);
  });

  it('QA19-DAT-03 distingue el fallo del proveedor de un correo sin transacción', async () => {
    executedCaseIds.add('QA19-DAT-03');
    const user = await createUser('dat-03');
    const { manifest } = await importEmails({
      user,
      modelResponse: 'failure',
      emails: [
        serviceEmail({
          messageId: 'qa19-dat-03',
          subject: 'Novedades de BHD',
          text: 'Conoce las novedades de tu banco.',
          receivedAt: '2031-05-13T12:00:00.000Z',
        }),
      ],
    });

    expect(manifest.items[0]).toMatchObject({
      classification: null,
      classificationUnavailableReason: 'INFERENCE_PROVIDER_FAILURE',
      signal: { published: false, reason: 'CLASSIFICATION_UNAVAILABLE' },
    });
    expectOutcome(manifest.items[0], {
      outcome: 'REJECTED',
      reason: 'INFERENCE_PROVIDER_FAILURE',
    });
    const message = await prisma.aiEmailMessage.findFirstOrThrow({
      where: { userId: user.userId },
      select: { processingStatus: true },
    });
    expect(message.processingStatus).toBe('REVIEW_REQUIRED');
    await expect(transactionRows(user.userId)).resolves.toHaveLength(0);
  });

  it('QA19-DAT-04 deja la fecha del correo solo como sugerencia', async () => {
    executedCaseIds.add('QA19-DAT-04');
    const user = await createUser('dat-04');
    const { manifest, messageIds } = await importEmails({
      user,
      modelResponse: {
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        confidence: 0.91,
        transaction: {
          kind: 'TRANSACTION',
          amount: 15,
          currency: 'DOP',
          direction: 'DEBIT',
          movementClass: 'PURCHASE',
          merchant: 'COMERCIO SIN FECHA',
        },
      },
      emails: [
        serviceEmail({
          messageId: 'qa19-dat-04',
          subject: 'Consumo sin fecha de operación',
          text: 'Tu tarjeta registró un consumo de RD$15.00. Consulta el detalle en la app.',
          receivedAt: '2031-05-14T12:00:00.000Z',
        }),
      ],
    });

    expect(manifest.items[0].signal).toEqual({ published: true });
    expectOutcome(manifest.items[0], {
      outcome: 'REVIEW_REQUIRED',
      reason: 'TRANSACTION_DATE_SUGGESTED',
    });
    await expect(transactionRows(user.userId)).resolves.toHaveLength(0);
    const imported = await readImport(user.userId, messageIds[0]);
    expect(imported).toMatchObject({
      status: 'REVIEW_REQUIRED',
      reviewReason: 'TRANSACTION_DATE_SUGGESTED',
    });
  });

  it('QA19-REV-01 revierte la compra indicada por referencia', async () => {
    executedCaseIds.add('QA19-REV-01');
    const user = await createUser('rev-01');
    const purchase = await createPriorTransaction({
      user,
      type: 'DEBIT',
      amount: 120,
      transactionDate: '2031-05-15T14:00:00.000Z',
      externalReference: 'REF-QA19-15',
      cardId: user.cardId,
    });
    const { manifest, messageIds } = await importEmails({
      user,
      modelResponse: {
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        confidence: 0.95,
        transaction: {
          kind: 'TRANSACTION',
          amount: 120,
          currency: 'DOP',
          transactionDate: '2031-05-15T18:00:00.000Z',
          direction: 'CREDIT',
          movementClass: 'REFUND',
          last4: '1111',
          reverseOfBankReference: 'REF-QA19-15',
        },
      },
      emails: [
        serviceEmail({
          messageId: 'qa19-rev-01',
          subject: 'Reverso de tu compra',
          text: 'Reverso de tu compra con tarjeta por RD$120.00. Fecha y hora de la transacción: 15/05/2031 - 02:00 PM.',
          receivedAt: '2031-05-15T18:02:00.000Z',
        }),
      ],
    });

    expectOutcome(manifest.items[0], { outcome: 'APPLIED' });
    const rows = await transactionRows(user.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: purchase.id, status: 'REVERSED' });
    const imported = await readImport(user.userId, messageIds[0]);
    expect(imported).toMatchObject({
      status: 'REVERSED',
      transactionId: purchase.id,
    });
  });

  it('QA19-REV-02 vincula el reverso cuando su compra aparece después', async () => {
    executedCaseIds.add('QA19-REV-02');
    const user = await createUser('rev-02');
    const { manifest, messageIds } = await importEmails({
      user,
      emails: [
        cardAlertEmail({
          messageId: 'qa19-rev-02-reverso',
          transactionDate: '2031-05-16T18:00:00.000Z',
          amount: '200.00',
          currency: 'DOP',
          merchant: null,
          status: 'Reversada',
        }),
        cardAlertEmail({
          messageId: 'qa19-rev-02-compra',
          transactionDate: '2031-05-16T17:58:00.000Z',
          amount: '200.00',
          currency: 'DOP',
          merchant: 'TIENDA SINTÉTICA',
        }),
      ],
    });

    expect(manifest.items.map((item) => item.execution?.outcome)).toEqual([
      'REVIEW_REQUIRED',
      'APPLIED',
    ]);
    expect(manifest.items[0].execution?.reason).toBe(
      'REVERSAL_ORIGINAL_NOT_FOUND',
    );
    const rows = await transactionRows(user.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'DEBIT',
      status: 'REVERSED',
      description: 'TIENDA SINTÉTICA',
    });
    const refund = await readImport(user.userId, messageIds[0]);
    expect(refund).toMatchObject({
      status: 'REVERSED',
      transactionId: rows[0].id,
    });
  });

  it('QA19-REV-03 revierte sin comercio por la tarjeta y su cuenta', async () => {
    executedCaseIds.add('QA19-REV-03');
    const user = await createUser('rev-03');
    const purchase = await createPriorTransaction({
      user,
      type: 'DEBIT',
      amount: 300,
      transactionDate: '2031-05-17T15:00:00.000Z',
      cardId: user.cardId,
    });
    const { manifest, messageIds } = await importEmails({
      user,
      emails: [
        cardAlertEmail({
          messageId: 'qa19-rev-03',
          transactionDate: '2031-05-17T17:00:00.000Z',
          amount: '300.00',
          currency: 'DOP',
          merchant: null,
          status: 'Reversada',
        }),
      ],
    });

    expectOutcome(manifest.items[0], { outcome: 'APPLIED' });
    const rows = await transactionRows(user.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: purchase.id, status: 'REVERSED' });
    const imported = await readImport(user.userId, messageIds[0]);
    expect(imported).toMatchObject({
      status: 'REVERSED',
      transactionId: purchase.id,
    });
    const original = await prisma.finTransaction.findUniqueOrThrow({
      where: { id: purchase.id },
      select: { aiMetadata: true },
    });
    expect(original.aiMetadata).toMatchObject({ reversalStep: 'CARD_ACCOUNT' });
  });

  it('QA19-REV-04 registra el reverso parcial sin cambiar el monto original', async () => {
    executedCaseIds.add('QA19-REV-04');
    const user = await createUser('rev-04');
    const purchase = await createPriorTransaction({
      user,
      type: 'DEBIT',
      amount: 200,
      transactionDate: '2031-05-18T15:00:00.000Z',
      externalReference: 'REF-QA19-18',
      cardId: user.cardId,
    });
    const { manifest } = await importEmails({
      user,
      modelResponse: {
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        confidence: 0.95,
        transaction: {
          kind: 'TRANSACTION',
          amount: 50,
          currency: 'DOP',
          transactionDate: '2031-05-18T17:00:00.000Z',
          direction: 'CREDIT',
          movementClass: 'REFUND',
          last4: '1111',
          reverseOfBankReference: 'REF-QA19-18',
        },
      },
      emails: [
        serviceEmail({
          messageId: 'qa19-rev-04',
          subject: 'Reverso parcial de tu compra',
          text: 'Reverso parcial de RD$50.00 sobre tu compra de RD$200.00. Fecha y hora de la transacción: 18/05/2031 - 01:00 PM.',
          receivedAt: '2031-05-18T17:02:00.000Z',
        }),
      ],
    });

    expectOutcome(manifest.items[0], { outcome: 'APPLIED' });
    const rows = await transactionRows(user.userId);
    expect(rows).toHaveLength(2);
    const original = rows.find((row) => row.id === purchase.id);
    const refund = rows.find((row) => row.id !== purchase.id);
    expect(original).toMatchObject({ status: 'CONFIRMED', type: 'DEBIT' });
    expect(original?.amount.toString()).toBe('200');
    expect(refund).toMatchObject({
      type: 'CREDIT',
      status: 'CONFIRMED',
      cardId: user.cardId,
      linkedTransactionId: purchase.id,
    });
    expect(refund?.amount.toString()).toBe('50');
  });

  it('la matriz cubre sus 19 casos y cada uno declara su origen', () => {
    const matrixIds = QA19_CASES.filter(
      (qaCase) => qaCase.coveredBy === QA19_MATRIX_SPEC,
    ).map((qaCase) => qaCase.id);
    expect([...executedCaseIds].sort()).toEqual([...matrixIds].sort());
    expect(new Set(QA19_CASES.map((qaCase) => qaCase.id)).size).toBe(
      QA19_CASES.length,
    );
    expect(QA19_CASES.length).toBe(19);
    for (const qaCase of QA19_CASES) {
      expect(qaCase.source.length).toBeGreaterThan(0);
    }
    const ctr02Source = readFileSync(resolve(__dirname, CTR02_SPEC), 'utf8');
    expect(ctr02Source).toContain(CTR02_TEST_TITLE);
  });
});
