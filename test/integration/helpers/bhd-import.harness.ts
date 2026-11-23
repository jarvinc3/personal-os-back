import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  StructuredInferenceProviderError,
  type ExchangeRateResult,
  type InferenceCompletionPort,
  type StructuredInference,
} from '@personal-os/contracts';
import type { Env } from '@personal-os/config';
import { PrismaService } from '@personal-os/database';
import { LogoService } from '@personal-os/logos';
import type { UsersRepositoryPort } from '@personal-os/users';
// eslint-disable-next-line no-restricted-imports -- El arnés arma el consumidor real con su grafo.
import { createFinanceSignalConsumer } from '../../../packages/finance/src/signals/signal-consumer.test-setup';
import {
  AiSignalConsumerRegistry,
  EmailSampleImportService,
} from '@personal-os/intelligence';
// eslint-disable-next-line no-restricted-imports -- El barrel no expone este servicio interno.
import { AiSignalsService } from '../../../packages/intelligence/src/signals/ai-signals.service';
// eslint-disable-next-line no-restricted-imports -- El arnés ejercita los servicios reales contra la base.
import { AiEmailClassificationService } from '../../../packages/intelligence/src/email/ai-email-classification.service';
// eslint-disable-next-line no-restricted-imports -- El arnés ejercita los servicios reales contra la base.
import { EmailSampleImportJobsRepository } from '../../../packages/intelligence/src/email/email-sample-import-jobs.repository';
// eslint-disable-next-line no-restricted-imports -- El arnés ejercita los servicios reales contra la base.
import { FinanceEmailProductHints } from '../../../packages/finance/src/ledger/application/email-product-hints.service';
// eslint-disable-next-line no-restricted-imports -- El arnés ejercita los servicios reales contra la base.
import { ImportCardPaymentUseCase } from '../../../packages/finance/src/ledger/application/import-card-payment.use-case';
// eslint-disable-next-line no-restricted-imports -- El arnés ejercita los servicios reales contra la base.
import { ImportFinancialTransactionUseCase } from '../../../packages/finance/src/ledger/application/import-financial-transaction.use-case';
// eslint-disable-next-line no-restricted-imports -- El arnés ejercita los servicios reales contra la base.
import { LedgerQueryService } from '../../../packages/finance/src/ledger/application/ledger-query.service';
// eslint-disable-next-line no-restricted-imports -- El arnés ejercita los servicios reales contra la base.
import { ReverseTransactionUseCase } from '../../../packages/finance/src/ledger/application/reverse-transaction.use-case';
// eslint-disable-next-line no-restricted-imports -- El arnés ejercita los servicios reales contra la base.
import { PrismaLedgerImportRepository } from '../../../packages/finance/src/ledger/infrastructure/prisma-ledger-import.repository';
// eslint-disable-next-line no-restricted-imports -- El arnés ejercita los servicios reales contra la base.
import { PrismaLedgerReadRepository } from '../../../packages/finance/src/ledger/infrastructure/prisma-ledger-read.repository';
// eslint-disable-next-line no-restricted-imports -- El arnés ejercita los servicios reales contra la base.
import { PrismaLedgerReversalRepository } from '../../../packages/finance/src/ledger/infrastructure/prisma-ledger-reversal.repository';
// eslint-disable-next-line no-restricted-imports -- El arnés ejercita los servicios reales contra la base.
import { PrismaLedgerWriteRepository } from '../../../packages/finance/src/ledger/infrastructure/prisma-ledger-write.repository';
// eslint-disable-next-line no-restricted-imports -- El arnés ejercita los servicios reales contra la base.
import { ResolveAmountsUseCase } from '../../../packages/finance/src/fx/application/resolve-amounts.use-case';
// eslint-disable-next-line no-restricted-imports -- El arnés ejercita los servicios reales contra la base.
import { ResolveUserBaseCurrencyUseCase } from '../../../packages/finance/src/fx/application/resolve-user-base-currency';
// eslint-disable-next-line no-restricted-imports -- El arnés ejercita los servicios reales contra la base.
import { MerchantsService } from '../../../packages/finance/src/merchants/application/merchants.service';
// eslint-disable-next-line no-restricted-imports -- El arnés ejercita los servicios reales contra la base.
import { MerchantsRepository } from '../../../packages/finance/src/merchants/infrastructure/merchants.repository';
// eslint-disable-next-line no-restricted-imports -- El arnés ejercita los servicios reales contra la base.
import { FinanceOwnershipService } from '../../../packages/finance/src/shared/application/finance-ownership.service';

/** Tasa sintética de la muestra; no pretende reflejar el mercado real. */
export const SYNTHETIC_USD_RATE = 60;

export type BhdEmailFixture = {
  messageId: string;
  from: string;
  subject: string;
  date: string;
  text: string;
};

export type BhdUser = {
  userId: string;
  connectionId: string;
  institutionId: string;
  savingsAccountId: string;
  cardId: string;
};

export type BhdImportHarness = {
  service: EmailSampleImportService;
  createUser: (suffix: string) => Promise<BhdUser>;
  createMessage: (user: BhdUser, email: BhdEmailFixture) => Promise<string>;
  deleteUsers: (userIds: readonly string[]) => Promise<void>;
  setModelResponse: (value: unknown) => void;
  clearModelResponse: () => void;
  failModelInference: () => void;
};

const CLASSIFICATION_LIMITS: Record<string, unknown> = {
  // La muestra del piloto son 20 correos y la prueba la repite en el mismo
  // minuto para comprobar la idempotencia; el ritmo real (20) la cortaría.
  AI_EMAIL_CLASSIFICATIONS_PER_MINUTE: 200,
  AI_EMAIL_INITIAL_BUDGET: 500,
  AI_EMAIL_DAILY_TOKEN_BUDGET: 320_000,
  AI_EMAIL_DAILY_COST_LIMIT_USD: 5,
  AI_EMAIL_COST_ALERT_RATIO: 0.8,
  AI_EMAIL_MAX_CONTENT_CHARS: 24_000,
  AI_EMAIL_MAX_SUBJECT_CHARS: 1_000,
  AI_EMAIL_MAX_SENDER_CHARS: 320,
  AI_EMAIL_BANK_SENDER_DOMAINS: ['bhd.com.do'],
};

type RateRequest = { from: string; to: string };

/** Identidad para la moneda propia y tasa fija para el dólar de la muestra. */
function syntheticExchangeRates() {
  return {
    getHistoricalRate: ({ from, to }: RateRequest) =>
      Promise.resolve(syntheticRate(from, to)),
    getLedgerRate: ({ from, to }: RateRequest) =>
      Promise.resolve(syntheticRate(from, to)),
    getLatestRateOnOrBefore: ({ from, to }: RateRequest) =>
      Promise.resolve(syntheticRate(from, to)),
    listCurrencies: () => Promise.resolve(['DOP', 'USD']),
  };
}

function syntheticRate(from: string, to: string): ExchangeRateResult {
  if (from === to) {
    return { ok: true, rate: 1, source: 'identity' };
  }
  if (from === 'USD' && to === 'DOP') {
    return { ok: true, rate: SYNTHETIC_USD_RATE, source: 'api' };
  }
  if (from === 'DOP' && to === 'USD') {
    return { ok: true, rate: 1 / SYNTHETIC_USD_RATE, source: 'api' };
  }
  return {
    ok: false,
    code: 'NO_EXACT_RATE',
    message: `Sin tasa sintética ${from}->${to}`,
    retryable: false,
  };
}

function fakeConfig(): ConfigService<Env, true> {
  return {
    get: (key: string) => CLASSIFICATION_LIMITS[key],
  } as unknown as ConfigService<Env, true>;
}

/**
 * Grafo real del camino de importación: clasificador BHD, servicio de muestra y
 * consumidor de Finanzas contra PostgreSQL. Solo se sustituyen la inferencia
 * (no hay proveedor externo), la tasa de cambio y la entrega de eventos.
 */
export function createBhdImportHarness(
  prisma: PrismaService,
): BhdImportHarness {
  const events = { enqueue: () => Promise.resolve() };
  const relay = { wake: () => Promise.resolve() };
  const logos = {
    resolveUrl: () => null,
    ensureLogo: () => Promise.resolve(null),
  } as unknown as LogoService;
  const readRepository = new PrismaLedgerReadRepository(prisma);
  const writeRepository = new PrismaLedgerWriteRepository(prisma, events);
  const importRepository = new PrismaLedgerImportRepository(prisma, events);
  const reversalRepository = new PrismaLedgerReversalRepository(prisma, events);
  const ledger = new LedgerQueryService(readRepository, logos);
  const users = {
    findUserModuleBySlug: () => Promise.resolve(null),
  } as unknown as UsersRepositoryPort;
  const env = { get: () => 'DOP' } as unknown as ConfigService<Env, true>;
  const baseCurrency = new ResolveUserBaseCurrencyUseCase(users, env);
  const resolveAmounts = new ResolveAmountsUseCase(syntheticExchangeRates());
  const merchants = new MerchantsService(
    new MerchantsRepository(prisma),
    new FinanceOwnershipService(prisma),
    logos,
  );
  const consumer = createFinanceSignalConsumer({
    prisma,
    importTransaction: new ImportFinancialTransactionUseCase(
      importRepository,
      readRepository,
      writeRepository,
      resolveAmounts,
      baseCurrency,
      relay,
      merchants,
    ),
    ledger,
    reverseTransaction: new ReverseTransactionUseCase(
      reversalRepository,
      relay,
    ),
    cardPaymentImport: new ImportCardPaymentUseCase(
      writeRepository,
      resolveAmounts,
      baseCurrency,
      relay,
    ),
    merchants,
    baseCurrency,
  });

  let modelResponse:
    | { kind: 'value'; value: unknown }
    | { kind: 'failure'; error: Error }
    | null = null;
  const inference = {
    complete: () => Promise.reject(new Error('completion no usada')),
    infer: <T>(): Promise<StructuredInference<T>> => {
      if (modelResponse?.kind === 'failure') {
        return Promise.reject(modelResponse.error);
      }
      if (modelResponse?.kind === 'value') {
        return Promise.resolve({
          value: modelResponse.value as T,
          provider: 'synthetic',
          model: 'synthetic-model',
          latencyMs: 1,
          fallbackCount: 0,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
        });
      }
      return Promise.reject(
        new Error('El caso no preparó una respuesta del modelo'),
      );
    },
  } satisfies InferenceCompletionPort;

  const classification = new AiEmailClassificationService(
    prisma,
    inference,
    fakeConfig(),
    undefined,
    new FinanceEmailProductHints(prisma),
  );
  const registry = new AiSignalConsumerRegistry();
  registry.register(consumer);
  const service = new EmailSampleImportService(
    prisma,
    new EmailSampleImportJobsRepository(prisma),
    classification,
    registry,
    new AiSignalsService(prisma),
  );

  async function createUser(suffix: string): Promise<BhdUser> {
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@bhd-matrix.integration.test`,
        fullName: `Fixture sintética BHD ${suffix}`,
      },
    });
    const connection = await prisma.aiEmailConnection.create({
      data: {
        userId,
        emailAddress: `${userId}@synthetic.test`,
        accessTokenEncrypted: 'synthetic-fixture-token',
      },
    });
    const institution = await prisma.finInstitution.create({
      data: { userId, name: `Banco sintético ${suffix}`, type: 'bank' },
    });
    const savings = await prisma.finAccount.create({
      data: {
        userId,
        institutionId: institution.id,
        name: `Cuenta de ahorro ${suffix}`,
        type: 'SAVINGS',
        currency: 'DOP',
        accountNumberLast4: '1111',
        balance: 10_000,
      },
    });
    const card = await prisma.finCard.create({
      data: {
        userId,
        institutionId: institution.id,
        name: `Tarjeta ${suffix}`,
        type: 'CREDIT',
        lastFour: '1111',
        balances: { create: { currency: 'DOP', balance: 0 } },
      },
    });
    return {
      userId,
      connectionId: connection.id,
      institutionId: institution.id,
      savingsAccountId: savings.id,
      cardId: card.id,
    };
  }

  async function createMessage(
    user: BhdUser,
    email: BhdEmailFixture,
  ): Promise<string> {
    const messageId = randomUUID();
    await prisma.aiEmailMessage.create({
      data: {
        id: messageId,
        userId: user.userId,
        connectionId: user.connectionId,
        providerMessageId: email.messageId,
        receivedAt: new Date(email.date),
        fromAddress: email.from,
        fromDomain: email.from.split('@')[1],
        subject: email.subject,
        contentFingerprint: randomUUID().replaceAll('-', ''),
        templateFingerprint: `template-${email.messageId}`,
        processingStatus: 'QUEUED',
        content: { create: { sanitizedBody: email.text } },
      },
    });
    return messageId;
  }

  async function deleteUsers(userIds: readonly string[]): Promise<void> {
    if (!userIds.length) {
      return;
    }
    const scope = { userId: { in: [...userIds] } };
    await prisma.aiEmailSampleImport.deleteMany({ where: scope });
    await prisma.aiSignalEvidence.deleteMany({ where: scope });
    await prisma.aiSignal.deleteMany({ where: scope });
    await prisma.aiEmailClassification.deleteMany({ where: scope });
    await prisma.aiKnowledgeObservation.deleteMany({ where: scope });
    await prisma.aiAnalysisRun.deleteMany({ where: scope });
    await prisma.aiDatasetItem.deleteMany({ where: scope });
    await prisma.aiEmailMessage.deleteMany({ where: scope });
    await prisma.finSignalImport.deleteMany({ where: scope });
    await prisma.finTransaction.deleteMany({ where: scope });
    await prisma.finCard.deleteMany({ where: scope });
    await prisma.finAccount.deleteMany({ where: scope });
    await prisma.finInstitution.deleteMany({ where: scope });
    await prisma.aiEmailConnection.deleteMany({ where: scope });
    await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
  }

  return {
    service,
    createUser,
    createMessage,
    deleteUsers,
    setModelResponse: (value) => {
      modelResponse = { kind: 'value', value };
    },
    clearModelResponse: () => {
      modelResponse = null;
    },
    failModelInference: () => {
      modelResponse = {
        kind: 'failure',
        error: new StructuredInferenceProviderError(
          true,
          'synthetic',
          'synthetic',
        ),
      };
    },
  };
}
