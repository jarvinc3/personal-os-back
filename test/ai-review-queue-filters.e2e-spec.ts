import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@personal-os/database';
import { applyE2eTestOverrides } from './helpers/e2e-test.providers';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock, type PrismaMock } from './helpers/prisma.mock';

const { AppModule } = require('../apps/api/src/app.module') as {
  AppModule: new (...args: never[]) => unknown;
};

type Query = Record<string, unknown>;

type ReviewMessage = {
  id: string;
  userId: string;
  receivedAt: Date;
  fromAddress: string;
  fromDomain: string;
  subject: string;
  contentFingerprint: string;
  processingStatus: string;
};

type StoredPartition = {
  datasetId: string;
  userId: string;
  sourceType: string;
  sourceId: string;
  partition: 'TRAIN' | 'VALIDATION' | 'HOLDOUT';
};

type StoredVerification = {
  userId: string;
  targetType: string;
  targetId: string;
  sequence: bigint;
  verdict: 'CONFIRMED' | 'CORRECTED' | 'REJECTED';
  correctedPayload: unknown;
  notes: string | null;
  createdAt: Date;
};

type StoredClassification = {
  messageId: string;
  route: string;
  confidence: number;
  decisionPath: string;
};

const USER_ID = 'user-123';
const USER_TIMEZONE = 'America/Santo_Domingo';
const VERIFIED_AT = new Date('2026-10-25T12:00:00.000Z');

const message = ({
  id,
  receivedAt,
  fromAddress = 'notifications@github.com',
  subject,
  userId = USER_ID,
}: {
  id: string;
  receivedAt: string;
  fromAddress?: string;
  subject: string;
  userId?: string;
}): ReviewMessage => ({
  id,
  userId,
  receivedAt: new Date(receivedAt),
  fromAddress,
  fromDomain: fromAddress.split('@')[1] ?? 'example.com',
  subject,
  contentFingerprint: `fingerprint-${id}`,
  processingStatus: 'INGESTED',
});

const bulkMessages = Array.from({ length: 60 }, (_, index) =>
  message({
    id: `bulk-${index}`,
    receivedAt: new Date(Date.UTC(2026, 8, 1, 12, index, 0)).toISOString(),
    fromAddress: 'bulk@example.com',
    subject: `Bulk ${index}`,
  }),
);

const githubMessages = [
  message({
    id: 'gh-0',
    receivedAt: '2026-10-01T12:00:00.000Z',
    subject: 'Revisión de seguridad de GitHub',
  }),
  message({
    id: 'gh-1',
    receivedAt: '2026-10-01T13:00:00.000Z',
    subject: 'Nueva actividad en tu cuenta',
  }),
  message({
    id: 'gh-2',
    receivedAt: '2026-10-01T14:00:00.000Z',
    subject: 'Aviso de inicio de sesión',
  }),
  message({
    id: 'gh-3',
    receivedAt: '2026-10-01T15:00:00.000Z',
    subject: 'SEGURIDAD: revisa tu cuenta',
  }),
  message({
    id: 'gh-4',
    receivedAt: '2026-10-01T16:00:00.000Z',
    subject: 'Nueva actividad en tu cuenta',
  }),
];

const dateRangeMessages = [
  message({
    id: 'date-0',
    receivedAt: '2026-10-02T03:59:00.000Z',
    fromAddress: 'dates@example.com',
    subject: 'Antes del rango',
  }),
  message({
    id: 'date-1',
    receivedAt: '2026-10-02T04:00:00.000Z',
    fromAddress: 'dates@example.com',
    subject: 'Primer instante del rango',
  }),
  message({
    id: 'date-2',
    receivedAt: '2026-10-04T03:59:00.000Z',
    fromAddress: 'dates@example.com',
    subject: 'Último instante del rango',
  }),
  message({
    id: 'date-3',
    receivedAt: '2026-10-04T04:00:00.000Z',
    fromAddress: 'dates@example.com',
    subject: 'Después del rango',
  }),
];

const otherAccountMessages = Array.from({ length: 3 }, (_, index) =>
  message({
    id: `other-${index}`,
    receivedAt: '2026-10-01T12:00:00.000Z',
    subject: 'Correo ajeno',
    userId: 'other-user',
  }),
);

const asQuery = (value: unknown): Query =>
  typeof value === 'object' && value !== null ? (value as Query) : {};

const matchesId = (messageId: string, filter: unknown): boolean => {
  if (typeof filter === 'string') {
    return messageId === filter;
  }
  const { in: allowed, notIn: excluded, gt, lt } = asQuery(filter);
  if (Array.isArray(allowed)) {
    return allowed.includes(messageId);
  }
  if (Array.isArray(excluded)) {
    return !excluded.includes(messageId);
  }
  if (typeof gt === 'string') {
    return messageId > gt;
  }
  if (typeof lt === 'string') {
    return messageId < lt;
  }
  return true;
};

const matchesText = (actual: string, filter: unknown): boolean => {
  if (typeof filter === 'string') {
    return actual === filter;
  }
  const { equals, contains, mode } = asQuery(filter);
  const normalize =
    mode === 'insensitive'
      ? (value: string) => value.toLowerCase()
      : (value: string) => value;
  if (typeof equals === 'string') {
    return normalize(actual) === normalize(equals);
  }
  if (typeof contains === 'string') {
    return normalize(actual).includes(normalize(contains));
  }
  return true;
};

const instantOf = (value: unknown): number | undefined =>
  value instanceof Date ? value.getTime() : undefined;

const matchesDate = (actual: Date, filter: unknown): boolean => {
  if (filter instanceof Date) {
    return actual.getTime() === filter.getTime();
  }
  const { gt, gte, lt, lte } = asQuery(filter);
  const instant = actual.getTime();
  const after = instantOf(gt);
  if (after !== undefined && instant <= after) {
    return false;
  }
  const afterOrEqual = instantOf(gte);
  if (afterOrEqual !== undefined && instant < afterOrEqual) {
    return false;
  }
  const before = instantOf(lt);
  if (before !== undefined && instant >= before) {
    return false;
  }
  const beforeOrEqual = instantOf(lte);
  if (beforeOrEqual !== undefined && instant > beforeOrEqual) {
    return false;
  }
  return true;
};

const matchesNumber = (actual: number, filter: unknown): boolean => {
  if (typeof filter === 'number') {
    return actual === filter;
  }
  const { lt, lte, gt, gte } = asQuery(filter);
  if (typeof lt === 'number' && actual >= lt) {
    return false;
  }
  if (typeof lte === 'number' && actual > lte) {
    return false;
  }
  if (typeof gt === 'number' && actual <= gt) {
    return false;
  }
  if (typeof gte === 'number' && actual < gte) {
    return false;
  }
  return true;
};

const matchesClassification = (
  classification: StoredClassification,
  where: Query,
): boolean => {
  if (
    where.confidence !== undefined &&
    !matchesNumber(classification.confidence, where.confidence)
  ) {
    return false;
  }
  return (
    typeof where.decisionPath !== 'string' ||
    classification.decisionPath === where.decisionPath
  );
};

const matchesProcessingStatus = (actual: string, filter: unknown): boolean => {
  if (typeof filter === 'string') {
    return actual === filter;
  }
  const { not, notIn, in: included } = asQuery(filter);
  if (typeof not === 'string' && actual === not) {
    return false;
  }
  if (Array.isArray(notIn) && notIn.includes(actual)) {
    return false;
  }
  if (Array.isArray(included)) {
    return included.includes(actual);
  }
  return true;
};

const matchesMessage = ({
  message: row,
  where,
  classifications,
}: {
  message: ReviewMessage;
  where: Query;
  classifications: readonly StoredClassification[];
}): boolean => {
  if (typeof where.userId === 'string' && row.userId !== where.userId) {
    return false;
  }
  if (
    where.processingStatus !== undefined &&
    !matchesProcessingStatus(row.processingStatus, where.processingStatus)
  ) {
    return false;
  }
  if (where.id !== undefined && !matchesId(row.id, where.id)) {
    return false;
  }
  if (
    where.fromAddress !== undefined &&
    !matchesText(row.fromAddress, where.fromAddress)
  ) {
    return false;
  }
  if (where.subject !== undefined && !matchesText(row.subject, where.subject)) {
    return false;
  }
  if (
    where.receivedAt !== undefined &&
    !matchesDate(row.receivedAt, where.receivedAt)
  ) {
    return false;
  }
  const andClauses = where.AND;
  if (
    Array.isArray(andClauses) &&
    !andClauses.every((clause) =>
      matchesMessage({
        message: row,
        where: asQuery(clause),
        classifications,
      }),
    )
  ) {
    return false;
  }
  const orClauses = where.OR;
  if (
    Array.isArray(orClauses) &&
    !orClauses.some((clause) =>
      matchesMessage({
        message: row,
        where: asQuery(clause),
        classifications,
      }),
    )
  ) {
    return false;
  }
  if (where.classifications !== undefined) {
    const relation = asQuery(where.classifications);
    const related = classifications.filter(
      (classification) => classification.messageId === row.id,
    );
    if (
      relation.none !== undefined &&
      related.some((classification) =>
        matchesClassification(classification, asQuery(relation.none)),
      )
    ) {
      return false;
    }
    if (
      relation.some !== undefined &&
      !related.some((classification) =>
        matchesClassification(classification, asQuery(relation.some)),
      )
    ) {
      return false;
    }
  }
  return true;
};

const sortMessages = (
  rows: ReviewMessage[],
  orderBy: unknown,
): ReviewMessage[] => {
  const [primary] = Array.isArray(orderBy) ? orderBy.map(asQuery) : [];
  const direction = primary?.receivedAt === 'desc' ? -1 : 1;
  return [...rows].sort((left, right) => {
    const dateDelta = left.receivedAt.getTime() - right.receivedAt.getTime();
    if (dateDelta !== 0) {
      return dateDelta * direction;
    }
    return left.id.localeCompare(right.id) * direction;
  });
};

describe('AI-6 review queue filters (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let prismaMock: PrismaMock;
  let messages: ReviewMessage[];
  let partitions: StoredPartition[];
  let verifications: StoredVerification[];
  let classifications: StoredClassification[];

  const partition = ({
    sourceId,
    value,
    userId = USER_ID,
  }: {
    sourceId: string;
    value: StoredPartition['partition'];
    userId?: string;
  }): StoredPartition => ({
    datasetId: 'dataset-1',
    userId,
    sourceType: 'EMAIL_MESSAGE',
    sourceId,
    partition: value,
  });

  const verification = ({
    targetId,
    sequence,
    verdict,
    overrides = {},
  }: {
    targetId: string;
    sequence: bigint;
    verdict: StoredVerification['verdict'];
    overrides?: Partial<StoredVerification>;
  }): StoredVerification => ({
    userId: USER_ID,
    targetType: 'EMAIL_MESSAGE',
    targetId,
    sequence,
    verdict,
    correctedPayload: null,
    notes: null,
    createdAt: VERIFIED_AT,
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    token = createTestJwt({ sub: USER_ID });
    messages = [
      ...bulkMessages,
      ...githubMessages,
      ...dateRangeMessages,
      ...otherAccountMessages,
    ];
    partitions = [
      ...bulkMessages.map(({ id }) =>
        partition({ sourceId: id, value: 'TRAIN' }),
      ),
      partition({ sourceId: 'gh-0', value: 'TRAIN' }),
      partition({ sourceId: 'gh-1', value: 'TRAIN' }),
      partition({ sourceId: 'gh-2', value: 'HOLDOUT' }),
      partition({ sourceId: 'gh-3', value: 'TRAIN' }),
      partition({ sourceId: 'gh-4', value: 'TRAIN' }),
      ...dateRangeMessages.map(({ id }) =>
        partition({ sourceId: id, value: 'VALIDATION' }),
      ),
      ...otherAccountMessages.map(({ id }) =>
        partition({ sourceId: id, value: 'TRAIN', userId: 'other-user' }),
      ),
    ];
    verifications = [
      verification({ targetId: 'gh-0', sequence: 1n, verdict: 'CONFIRMED' }),
      verification({
        targetId: 'gh-0',
        sequence: 2n,
        verdict: 'CORRECTED',
        overrides: {
          correctedPayload: {
            relevance: true,
            semanticType: 'TECH_NOTIFICATION',
            routes: [],
          },
          notes: 'Etiqueta corregida',
        },
      }),
      verification({
        targetId: 'gh-1',
        sequence: 3n,
        verdict: 'REJECTED',
        overrides: { notes: 'Publicidad' },
      }),
      verification({ targetId: 'bulk-0', sequence: 4n, verdict: 'CONFIRMED' }),
      verification({
        targetId: 'other-0',
        sequence: 5n,
        verdict: 'CONFIRMED',
        overrides: { userId: 'other-user' },
      }),
    ];
    classifications = [];
    prismaMock = createPrismaMock();
    prismaMock.user.findUnique.mockResolvedValue({
      id: USER_ID,
      timezone: USER_TIMEZONE,
    });
    prismaMock.aiEmailMessage.findMany.mockImplementation(
      (command: {
        where?: Query;
        orderBy?: unknown;
        take?: number;
        select?: Query;
      }) => {
        const where = command.where ?? {};
        const matches = messages.filter((row) =>
          matchesMessage({ message: row, where, classifications }),
        );
        if (command.select?.contentFingerprint !== true) {
          return Promise.resolve(matches.map(({ id }) => ({ id })));
        }
        const rows = sortMessages(matches, command.orderBy);
        return Promise.resolve(
          command.take ? rows.slice(0, command.take) : rows,
        );
      },
    );
    prismaMock.aiDatasetItem.findMany.mockImplementation(
      (command: { where?: Query }) => {
        const where = command.where ?? {};
        const requested = asQuery(where.sourceId).in;
        return Promise.resolve(
          partitions.filter(
            (item) =>
              (where.datasetId === undefined ||
                item.datasetId === where.datasetId) &&
              (where.userId === undefined || item.userId === where.userId) &&
              (where.sourceType === undefined ||
                item.sourceType === where.sourceType) &&
              (!Array.isArray(requested) || requested.includes(item.sourceId)),
          ),
        );
      },
    );
    prismaMock.aiDatasetItem.groupBy.mockImplementation(
      (command: { where?: Query }) => {
        const where = command.where ?? {};
        const excluded = asQuery(where.sourceId).notIn;
        const counts = new Map<string, number>();
        for (const item of partitions) {
          if (
            (where.datasetId !== undefined &&
              item.datasetId !== where.datasetId) ||
            (where.userId !== undefined && item.userId !== where.userId) ||
            (where.sourceType !== undefined &&
              item.sourceType !== where.sourceType) ||
            (Array.isArray(excluded) && excluded.includes(item.sourceId))
          ) {
            continue;
          }
          counts.set(item.partition, (counts.get(item.partition) ?? 0) + 1);
        }
        return Promise.resolve(
          [...counts].map(([value, count]) => ({
            partition: value,
            _count: { _all: count },
          })),
        );
      },
    );
    prismaMock.aiHumanVerification.findMany.mockImplementation(
      (command: { where?: Query }) => {
        const where = command.where ?? {};
        const latest = new Map<string, StoredVerification>();
        verifications
          .filter(
            (row) =>
              (where.userId === undefined || row.userId === where.userId) &&
              (where.targetType === undefined ||
                row.targetType === where.targetType),
          )
          .sort((left, right) => Number(left.sequence - right.sequence))
          .forEach((row) => latest.set(row.targetId, row));
        return Promise.resolve([...latest.values()]);
      },
    );

    const moduleFixture = await applyE2eTestOverrides(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prismaMock),
    ).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => app?.close());

  const getQueue = (query = '') =>
    request(app.getHttpServer())
      .get(`/api/intelligence/review-queue${query}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

  const expectedPendingCounts = {
    TRAIN: 61,
    VALIDATION: 4,
    HOLDOUT: 1,
    all: 66,
  };

  const senderPendingCounts = {
    TRAIN: 2,
    VALIDATION: 0,
    HOLDOUT: 1,
    all: 3,
  };

  it('filters by sender of the authenticated account and recalculates the counts', async () => {
    const response = await getQueue('?fromAddress=notifications@github.com');

    expect(
      response.body.data.items.map(({ id }: { id: string }) => id),
    ).toEqual(['gh-2', 'gh-3', 'gh-4']);
    expect(
      response.body.data.items.every(
        ({ fromAddress }: { fromAddress: string }) =>
          fromAddress === 'notifications@github.com',
      ),
    ).toBe(true);
    expect(JSON.stringify(response.body.data)).not.toContain('other-');
    expect(response.body.data.counts).toEqual(senderPendingCounts);
    expect(response.body.data).toMatchObject({
      hasMore: false,
      nextCursor: null,
    });
  });

  it('searches a subject text without matching case', async () => {
    const response = await getQueue('?subject=CUENTA');

    expect(
      response.body.data.items.map(({ id }: { id: string }) => id),
    ).toEqual(['gh-3', 'gh-4']);
  });

  it('filters by received date range in the account timezone', async () => {
    const response = await getQueue(
      '?fromAddress=dates@example.com&dateFrom=2026-10-02&dateTo=2026-10-03',
    );

    expect(
      response.body.data.items.map(({ id }: { id: string }) => id),
    ).toEqual(['date-1', 'date-2']);
  });

  it('combines the sender filter with a partition', async () => {
    const response = await getQueue(
      '?fromAddress=notifications@github.com&partition=HOLDOUT',
    );

    expect(
      response.body.data.items.map(({ id }: { id: string }) => id),
    ).toEqual(['gh-2']);
  });

  it('returns the last verification with its labels for a verified status', async () => {
    const response = await getQueue('?status=CORRECTED');

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0]).toMatchObject({
      id: 'gh-0',
      partition: 'TRAIN',
      status: 'CORRECTED',
      verification: {
        verdict: 'CORRECTED',
        labels: {
          relevance: true,
          semanticType: 'TECH_NOTIFICATION',
          routes: [],
        },
        notes: 'Etiqueta corregida',
        createdAt: VERIFIED_AT.toISOString(),
      },
    });
    expect(response.body.data.counts).toEqual(expectedPendingCounts);
  });

  it('filters several verified statuses in one request', async () => {
    const response = await getQueue('?status=CONFIRMED,REJECTED');

    expect(
      response.body.data.items.map(({ id }: { id: string }) => id),
    ).toEqual(['bulk-0', 'gh-1']);
    expect(response.body.data.items[0]).toMatchObject({
      status: 'CONFIRMED',
      verification: { verdict: 'CONFIRMED', labels: null, notes: null },
    });
    expect(response.body.data.items[1]).toMatchObject({
      status: 'REJECTED',
      verification: { verdict: 'REJECTED', notes: 'Publicidad' },
    });
  });

  it('keeps the newest order across pages without duplicates or gaps', async () => {
    const first = await getQueue('?fromAddress=bulk@example.com&order=NEWEST');
    const firstPage = first.body.data as {
      items: Array<{ id: string }>;
      nextCursor: string;
      hasMore: boolean;
    };

    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();
    expect(firstPage.items[0].id).toBe('bulk-59');
    expect(firstPage.items.at(-1)?.id).toBe('bulk-10');

    const second = await getQueue(
      `?fromAddress=bulk@example.com&order=NEWEST&cursor=${encodeURIComponent(
        firstPage.nextCursor,
      )}`,
    );
    const secondPage = second.body.data as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    };

    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.items.map(({ id }) => id)).toEqual(
      Array.from({ length: 9 }, (_, index) => `bulk-${9 - index}`),
    );

    const seen = [...firstPage.items, ...secondPage.items].map(({ id }) => id);
    expect(new Set(seen).size).toBe(59);
    expect(seen.filter((id) => id === 'bulk-0')).toEqual([]);
  });

  it.each([
    '?status=UNKNOWN',
    '?status=PENDING,UNKNOWN',
    '?dateFrom=2026-13-01',
    '?dateFrom=2026-10-01T00:00:00.000Z',
    '?dateFrom=2026-10-31&dateTo=2026-10-01',
    '?order=SIDEWAYS',
    '?partition=OTHER',
    '?limit=10',
  ])('rejects the invalid filter %s', async (query) => {
    await request(app.getHttpServer())
      .get(`/api/intelligence/review-queue${query}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  describe('reclassification versus human verification', () => {
    const sender = 'alertas@banco.com';

    beforeEach(() => {
      messages.push(
        {
          ...message({
            id: 'reclass-0',
            receivedAt: '2026-10-05T12:00:00.000Z',
            fromAddress: sender,
            subject: 'Consumo reclasificado',
          }),
          processingStatus: 'PROCESSED',
        },
        {
          ...message({
            id: 'corrected-0',
            receivedAt: '2026-10-05T12:30:00.000Z',
            fromAddress: sender,
            subject: 'Consumo corregido',
          }),
          processingStatus: 'PROCESSED',
        },
        {
          ...message({
            id: 'low-0',
            receivedAt: '2026-10-05T13:00:00.000Z',
            fromAddress: sender,
            subject: 'Consumo dudoso',
          }),
          processingStatus: 'REVIEW_REQUIRED',
        },
        {
          ...message({
            id: 'human-0',
            receivedAt: '2026-10-05T14:00:00.000Z',
            fromAddress: sender,
            subject: 'Consumo verificado',
          }),
          processingStatus: 'PROCESSED',
        },
      );
      partitions.push(
        partition({ sourceId: 'reclass-0', value: 'TRAIN' }),
        partition({ sourceId: 'corrected-0', value: 'TRAIN' }),
        partition({ sourceId: 'low-0', value: 'TRAIN' }),
        partition({ sourceId: 'human-0', value: 'TRAIN' }),
      );
      classifications.push(
        {
          messageId: 'reclass-0',
          route: 'FINANCE',
          confidence: 0.98,
          decisionPath: 'KNOWLEDGE',
        },
        {
          messageId: 'corrected-0',
          route: 'FINANCE',
          confidence: 0.98,
          decisionPath: 'MODEL',
        },
        {
          messageId: 'low-0',
          route: 'FINANCE',
          confidence: 0.4,
          decisionPath: 'MODEL',
        },
        {
          messageId: 'human-0',
          route: 'FINANCE',
          confidence: 0.98,
          decisionPath: 'MODEL',
        },
      );
      verifications.push(
        verification({
          targetId: 'human-0',
          sequence: 6n,
          verdict: 'CONFIRMED',
        }),
        verification({
          targetId: 'corrected-0',
          sequence: 7n,
          verdict: 'CORRECTED',
        }),
      );
    });

    const getSenderQueue = (query = '') =>
      getQueue(`?fromAddress=${sender}${query}`);

    it('removes a reclassified message from the pending queue', async () => {
      const response = await getSenderQueue();

      expect(
        response.body.data.items.map(({ id }: { id: string }) => id),
      ).toEqual(['low-0']);
      expect(
        response.body.data.items.map(
          ({ status }: { status: string }) => status,
        ),
      ).toEqual(['PENDING']);
      expect(response.body.data.counts).toEqual({
        TRAIN: 1,
        VALIDATION: 0,
        HOLDOUT: 0,
        all: 1,
      });
    });

    it('excludes a high-confidence knowledge row from the uncertain view', async () => {
      const response = await getSenderQueue('&uncertain=true');

      expect(
        response.body.data.items.map(({ id }: { id: string }) => id),
      ).toEqual(['low-0']);
    });

    it('lists a message under its human verification status', async () => {
      const response = await getSenderQueue('&status=CONFIRMED');

      expect(
        response.body.data.items.map(({ id }: { id: string }) => id),
      ).toEqual(['human-0']);
      expect(response.body.data.items[0]).toMatchObject({
        status: 'CONFIRMED',
      });
    });

    it('keeps the corrected history when pending and corrected are combined', async () => {
      const response = await getSenderQueue('&status=PENDING,CORRECTED');

      expect(
        response.body.data.items.map(({ id }: { id: string }) => id),
      ).toEqual(['corrected-0', 'low-0']);
      expect(
        response.body.data.items.map(
          ({ status }: { status: string }) => status,
        ),
      ).toEqual(['CORRECTED', 'PENDING']);
      expect(response.body.data.counts).toEqual({
        TRAIN: 1,
        VALIDATION: 0,
        HOLDOUT: 0,
        all: 1,
      });
    });
  });
});
