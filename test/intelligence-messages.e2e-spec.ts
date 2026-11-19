import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@personal-os/database';
import { applyE2eTestOverrides } from './helpers/e2e-test.providers';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock } from './helpers/prisma.mock';

const { AppModule } = require('../apps/api/src/app.module') as {
  AppModule: new (...args: never[]) => unknown;
};

const USER_ID = 'user-123';
const OTHER_USER_ID = 'user-999';
const PAGE_SIZE = 50;
const MESSAGE_COUNT = 120;
const PROCESSED_COUNT = 100;

type MessageRow = {
  id: string;
  userId: string;
  receivedAt: Date;
  fromAddress: string;
  fromDomain: string;
  subject: string;
  processingStatus: string;
  contentFingerprint: string | null;
};

type SearchCondition = {
  subject?: { contains: string };
  fromAddress?: { contains: string };
};

type CursorCondition = {
  receivedAt?: Date | { gt: Date };
  id?: { gt: string };
};

type MessageWhere = {
  userId: string;
  processingStatus?: string;
  OR?: CursorCondition[];
  AND?: { OR?: SearchCondition[] };
};

type FindManyArgs = { where: MessageWhere; take: number };

const SEARCH_MATCHES = [
  {
    id: 'message-5',
    subject: 'Aviso de pago',
    fromAddress: 'Facturas@Banco.com.do',
  },
  {
    id: `message-${MESSAGE_COUNT - 1}`,
    subject: 'FACTURA de noviembre',
    fromAddress: 'alertas@banco.com',
  },
];

function buildMessage(index: number): MessageRow {
  const override = SEARCH_MATCHES.find(
    (match) => match.id === `message-${index}`,
  );
  return {
    id: `message-${index}`,
    userId: USER_ID,
    receivedAt: new Date(Date.UTC(2026, 9, 1, 10, index)),
    fromAddress: override?.fromAddress ?? 'alertas@banco.com',
    fromDomain: 'banco.com',
    subject: override?.subject ?? `Consumo ${index}`,
    processingStatus: index < PROCESSED_COUNT ? 'PROCESSED' : 'REVIEW_REQUIRED',
    contentFingerprint: null,
  };
}

function matchesSearch(
  message: MessageRow,
  conditions: SearchCondition[],
): boolean {
  return conditions.some((condition) => {
    const field = condition.subject ?? condition.fromAddress;
    if (!field) {
      return false;
    }
    const text = condition.subject ? message.subject : message.fromAddress;
    return text.toLowerCase().includes(field.contains.toLowerCase());
  });
}

function matchesCursor(
  message: MessageRow,
  conditions: CursorCondition[],
): boolean {
  return conditions.some((condition) => {
    const receivedAt = condition.receivedAt;
    if (receivedAt instanceof Date) {
      return (
        message.receivedAt.getTime() === receivedAt.getTime() &&
        message.id > (condition.id?.gt ?? '')
      );
    }
    return receivedAt ? message.receivedAt > receivedAt.gt : false;
  });
}

function filterMessages(messages: MessageRow[], where: MessageWhere) {
  const search = where.AND?.OR;
  const cursor = where.OR;
  return messages
    .filter((message) => message.userId === where.userId)
    .filter(
      (message) =>
        !where.processingStatus ||
        message.processingStatus === where.processingStatus,
    )
    .filter((message) => !search || matchesSearch(message, search))
    .filter((message) => !cursor || matchesCursor(message, cursor))
    .sort(
      (first, second) =>
        first.receivedAt.getTime() - second.receivedAt.getTime() ||
        first.id.localeCompare(second.id),
    );
}

describe('Intelligence messages list (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let findMany: jest.Mock;

  const messages = [
    ...Array.from({ length: MESSAGE_COUNT }, (_, index) => buildMessage(index)),
    {
      ...buildMessage(MESSAGE_COUNT),
      id: 'other-user-message',
      userId: OTHER_USER_ID,
      subject: 'Factura ajena',
    },
  ];

  beforeEach(async () => {
    findMany = jest.fn(({ where, take }: FindManyArgs) =>
      Promise.resolve(filterMessages(messages, where).slice(0, take)),
    );
    const base = createPrismaMock();
    const prisma = {
      ...base,
      aiEmailMessage: { ...base.aiEmailMessage, findMany },
    };
    const moduleFixture = await applyE2eTestOverrides(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prisma),
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
    token = createTestJwt({ sub: USER_ID });
  });

  afterEach(async () => app?.close());

  async function listPage(query: string) {
    const response = await request(app.getHttpServer())
      .get(`/api/intelligence/messages${query}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return response.body.data as {
      items: Array<{ id: string; processingStatus: string }>;
      hasMore: boolean;
      nextCursor: string | null;
    };
  }

  it('encuentra por asunto y remitente un correo fuera de la primera página', async () => {
    const firstPage = await listPage('');
    expect(firstPage.items).toHaveLength(PAGE_SIZE);
    expect(
      firstPage.items.some(({ id }) => id === `message-${MESSAGE_COUNT - 1}`),
    ).toBe(false);

    const searchPage = await listPage('?q=factura');

    expect(searchPage.items.map(({ id }) => id)).toEqual([
      'message-5',
      `message-${MESSAGE_COUNT - 1}`,
    ]);
    expect(searchPage.items.map(({ id }) => id)).not.toContain(
      'other-user-message',
    );
  });

  it('filtra por estado y sigue paginando con el cursor', async () => {
    const firstPage = await listPage('?status=PROCESSED');

    expect(firstPage.items).toHaveLength(PAGE_SIZE);
    expect(
      firstPage.items.every(
        ({ processingStatus }) => processingStatus === 'PROCESSED',
      ),
    ).toBe(true);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = await listPage(
      `?status=PROCESSED&cursor=${encodeURIComponent(
        firstPage.nextCursor ?? '',
      )}`,
    );

    expect(secondPage.items).toHaveLength(PROCESSED_COUNT - PAGE_SIZE);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.nextCursor).toBeNull();
    expect(
      secondPage.items.every(
        ({ processingStatus }) => processingStatus === 'PROCESSED',
      ),
    ).toBe(true);
  });

  it('responde 400 con el motivo cuando el estado no existe', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/intelligence/messages?status=UNKNOWN')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(response.body.message).toContain('status debe ser uno de');
    expect(findMany).not.toHaveBeenCalled();
  });
});
