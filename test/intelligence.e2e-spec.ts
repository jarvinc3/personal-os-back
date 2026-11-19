import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@personal-os/database';
import {
  AiEvidenceService,
  AiKnowledgeService,
  AiDataDeletionService,
  AiConversationStore,
  AiOrchestrator,
  AiActionsService,
  ViewSuggestionsService,
  REVIEW_GROUP_VERDICTS,
  REVIEW_QUEUE_ORDERS,
  REVIEW_QUEUE_PARTITIONS,
  REVIEW_QUEUE_STATUSES,
  SEMANTIC_ROUTES,
  SEMANTIC_TYPES,
  SUGGESTED_TRANSACTION_DATE_SOURCES,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_KINDS,
  TRANSACTION_MOVEMENT_CLASSES,
} from '@personal-os/intelligence';
import { applyE2eTestOverrides } from './helpers/e2e-test.providers';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock } from './helpers/prisma.mock';

const { AppModule } = require('../apps/api/src/app.module') as {
  AppModule: new (...args: never[]) => unknown;
};

describe('Intelligence API (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  const evidence = {
    datasetSummary: jest.fn().mockResolvedValue({
      id: 'dataset-1',
      name: 'EMAIL_V1',
      partitions: { TRAIN: 3, VALIDATION: 1, HOLDOUT: 1 },
    }),
    reviewQueue: jest.fn().mockResolvedValue({
      items: [],
      hasMore: false,
      nextCursor: null,
    }),
    verifyMessage: jest.fn().mockResolvedValue({
      sequence: '7',
      verdict: 'CONFIRMED',
    }),
    verifyReviewSelection: jest.fn().mockResolvedValue({
      verified: 2,
      alreadyVerified: 0,
      requeued: 0,
    }),
    listReviewGroups: jest.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      totalGroups: 0,
      hasMore: false,
    }),
    verifyReviewGroup: jest.fn().mockResolvedValue({
      verified: 91,
      holdoutExcluded: 9,
      alreadyVerified: 0,
    }),
    listRuns: jest.fn().mockResolvedValue([]),
  };
  const knowledge = {
    listForUser: jest.fn().mockResolvedValue({ personal: [], global: [] }),
    adminQueue: jest.fn().mockResolvedValue([]),
    rebuild: jest.fn().mockResolvedValue({ runId: 'run-1', items: 0 }),
    revert: jest.fn().mockResolvedValue({ state: 'BLOCKED' }),
  };
  const deletion = {
    exportForUser: jest.fn().mockResolvedValue({ messages: [], knowledge: [] }),
    deleteMyData: jest
      .fn()
      .mockResolvedValue({ deleted: true, deletedMessages: 0 }),
  };
  const viewSuggestions = {
    list: jest.fn().mockResolvedValue([
      {
        id: 'suggestion-1',
        label: 'Revisá el presupuesto',
        prompt: '¿Cómo va el presupuesto del mes?',
        action: null,
      },
    ]),
    dismiss: jest.fn().mockResolvedValue(undefined),
  };
  const userRole = { findUnique: jest.fn().mockResolvedValue(null) };

  beforeEach(async () => {
    jest.clearAllMocks();
    token = createTestJwt({ sub: 'user-123' });
    const moduleFixture = await applyE2eTestOverrides(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue({ ...createPrismaMock(), userRole })
        .overrideProvider(AiEvidenceService)
        .useValue(evidence)
        .overrideProvider(AiKnowledgeService)
        .useValue(knowledge)
        .overrideProvider(AiDataDeletionService)
        .useValue(deletion)
        .overrideProvider(AiConversationStore)
        .useValue(conversations)
        .overrideProvider(AiOrchestrator)
        .useValue(orchestrator)
        .overrideProvider(AiActionsService)
        .useValue(actions)
        .overrideProvider(ViewSuggestionsService)
        .useValue(viewSuggestions),
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

  it('aísla el explorador/exportación y protege la cola ADMIN', async () => {
    userRole.findUnique.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get('/api/intelligence/knowledge')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(knowledge.listForUser).toHaveBeenCalledWith('user-123');
    await request(app.getHttpServer())
      .get('/api/intelligence/knowledge/me/export')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(deletion.exportForUser).toHaveBeenCalledWith('user-123');
    await request(app.getHttpServer())
      .get('/api/intelligence/knowledge/admin/queue')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(knowledge.adminQueue).not.toHaveBeenCalled();
  });

  it('exige confirmación para borrar y permite reconstruir solo a ADMIN', async () => {
    await request(app.getHttpServer())
      .delete('/api/intelligence/knowledge/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmed: false })
      .expect(400);
    await request(app.getHttpServer())
      .delete('/api/intelligence/knowledge/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await request(app.getHttpServer())
      .delete('/api/intelligence/knowledge/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmed: true, extra: 'no' })
      .expect(400);
    expect(deletion.deleteMyData).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .delete('/api/intelligence/knowledge/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmed: true })
      .expect(200);
    expect(deletion.deleteMyData).toHaveBeenCalledWith('user-123');
    await request(app.getHttpServer())
      .post('/api/intelligence/knowledge/admin/rebuild')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/intelligence/knowledge/admin/knowledge-1/revert')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(knowledge.revert).not.toHaveBeenCalled();
    userRole.findUnique.mockResolvedValue({ role: 'ADMIN' });
    await request(app.getHttpServer())
      .post('/api/intelligence/knowledge/admin/rebuild')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(knowledge.rebuild).toHaveBeenCalledWith('user-123');
    await request(app.getHttpServer())
      .get('/api/intelligence/knowledge/admin/queue')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(knowledge.adminQueue).toHaveBeenCalled();
    await request(app.getHttpServer())
      .post('/api/intelligence/knowledge/admin/knowledge-1/revert')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(knowledge.revert).toHaveBeenCalledWith('user-123', 'knowledge-1');
  });

  const conversation = {
    id: 'conversation-1',
    title: 'Gastos del mes',
    summary: null,
    summaryUpdatedAt: null,
    createdAt: new Date('2026-11-02T10:00:00Z'),
    updatedAt: new Date('2026-11-02T10:05:00Z'),
    messages: [
      {
        role: 'user',
        content: '¿Cuánto gasté?',
        createdAt: new Date('2026-11-02T10:01:00Z'),
      },
      {
        role: 'assistant',
        content: 'Gastaste RD$1,250.',
        createdAt: new Date('2026-11-02T10:02:00Z'),
      },
      {
        role: 'tool',
        content: '{"private":"trace"}',
        createdAt: new Date('2026-11-02T10:01:30Z'),
      },
    ],
  };
  const conversations = {
    create: jest.fn().mockResolvedValue({
      id: 'conversation-1',
      title: 'Nueva conversación',
      createdAt: conversation.createdAt,
      updatedAt: conversation.createdAt,
    }),
    list: jest
      .fn()
      .mockResolvedValue([{ ...conversation, _count: { messages: 3 } }]),
    findOwned: jest
      .fn()
      .mockImplementation((userId: string, id: string) =>
        userId === 'user-123' && id === 'conversation-1'
          ? Promise.resolve(conversation)
          : Promise.reject(new NotFoundException('Conversación no encontrada')),
      ),
    deleteOwned: jest.fn().mockResolvedValue(undefined),
    append: jest.fn().mockResolvedValue(undefined),
  };
  const orchestrator = {
    createConversation: jest.fn().mockResolvedValue({
      id: 'conversation-1',
      title: 'Nueva conversación',
      createdAt: conversation.createdAt,
      updatedAt: conversation.createdAt,
    }),
    sendMessage: jest.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      answer: 'Gastaste RD$1,250.',
      provider: 'Groq',
      model: 'test-model',
    }),
  };
  const actionRecord = {
    id: 'action-1',
    actionType: 'finance.update_budget',
    targetModule: 'finance',
    policy: 'CONFIRM_REQUIRED',
    status: 'PENDING',
    payload: { budgetId: 'budget-1' },
    result: null,
    createdAt: new Date('2026-11-02T10:00:00Z'),
    executedAt: null,
  };
  const actions = {
    listForUser: jest.fn().mockResolvedValue([actionRecord]),
    confirm: jest
      .fn()
      .mockImplementation((userId: string, id: string) =>
        userId === 'user-123' && id === 'action-1'
          ? Promise.resolve({ outcome: 'EXECUTED', action: actionRecord })
          : Promise.reject(new NotFoundException('Acción no encontrada')),
      ),
    cancel: jest.fn().mockResolvedValue({
      outcome: 'CANCELLED',
      action: { ...actionRecord, status: 'CANCELLED' },
    }),
  };

  it('exposes private conversation routes and leaves the legacy chat route removed', async () => {
    await request(app.getHttpServer())
      .post('/api/intelligence/conversations')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(orchestrator.createConversation).toHaveBeenCalledWith(
      'user-123',
      undefined,
    );

    await request(app.getHttpServer())
      .get('/api/intelligence/conversations')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => expect(body.data[0].messageCount).toBe(3));

    await request(app.getHttpServer())
      .get('/api/intelligence/conversations/conversation-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.messages).toHaveLength(2);
        expect(JSON.stringify(body)).not.toContain('private');
      });

    await request(app.getHttpServer())
      .post('/api/intelligence/conversations/conversation-1/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: '¿Cuánto gasté?' })
      .expect(201);
    expect(orchestrator.sendMessage).toHaveBeenCalledWith(
      'user-123',
      'conversation-1',
      '¿Cuánto gasté?',
      undefined,
    );

    const anotherUserToken = createTestJwt({ sub: 'user-B' });
    await request(app.getHttpServer())
      .get('/api/intelligence/conversations/conversation-1')
      .set('Authorization', `Bearer ${anotherUserToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .delete('/api/intelligence/conversations/conversation-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(conversations.deleteOwned).toHaveBeenCalledWith(
      'user-123',
      'conversation-1',
    );

    await request(app.getHttpServer())
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ messages: [{ role: 'user', content: 'hola' }] })
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/ai/sessions')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('lists own actions and exposes confirmation and cancellation routes', async () => {
    await request(app.getHttpServer())
      .get('/api/intelligence/actions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data[0]).toMatchObject({
          id: 'action-1',
          policy: 'CONFIRM_REQUIRED',
          status: 'PENDING',
        });
        expect(body.data[0]).not.toHaveProperty('userId');
        expect(body.data[0]).not.toHaveProperty('argumentDigest');
      });
    expect(actions.listForUser).toHaveBeenCalledWith('user-123');

    await request(app.getHttpServer())
      .post('/api/intelligence/actions/action-1/confirm')
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
      .expect(({ body }) =>
        expect(body.data).toMatchObject({
          outcome: 'EXECUTED',
          action: { id: 'action-1', status: 'PENDING' },
        }),
      );
    expect(actions.confirm).toHaveBeenCalledWith('user-123', 'action-1');

    await request(app.getHttpServer())
      .post('/api/intelligence/actions/action-1/cancel')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(actions.cancel).toHaveBeenCalledWith('user-123', 'action-1');

    await request(app.getHttpServer())
      .post('/api/intelligence/actions/action-1/confirm')
      .expect(401);
  });

  it('lists and dismisses view suggestions for the authenticated owner', async () => {
    await request(app.getHttpServer())
      .get(
        '/api/intelligence/view-suggestions?route=/finance/transactions&view=transactions',
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.suggestions).toHaveLength(1);
        expect(body.data.suggestions[0]).toMatchObject({
          id: 'suggestion-1',
          label: 'Revisá el presupuesto',
        });
      });
    expect(viewSuggestions.list).toHaveBeenCalledWith({
      userId: 'user-123',
      route: '/finance/transactions',
      view: 'transactions',
      sheet: undefined,
    });

    await request(app.getHttpServer())
      .get('/api/intelligence/view-suggestions')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    await request(app.getHttpServer())
      .delete('/api/intelligence/view-suggestions/suggestion-1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => expect(body.data.dismissed).toBe(true));
    expect(viewSuggestions.dismiss).toHaveBeenCalledWith({
      userId: 'user-123',
      suggestionId: 'suggestion-1',
    });

    await request(app.getHttpServer())
      .delete('/api/intelligence/view-suggestions/suggestion-1')
      .expect(401);
  });

  it('exposes the authenticated AI-3 dataset, review, verification, and run routes', async () => {
    await request(app.getHttpServer())
      .get('/api/intelligence/dataset')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.name).toBe('EMAIL_V1');
      });

    await request(app.getHttpServer())
      .get(
        '/api/intelligence/review-queue?cursor=next-page&partition=TRAIN&status=CONFIRMED,CORRECTED&fromAddress=notifications@github.com&subject=Aviso&dateFrom=2026-10-01&dateTo=2026-10-31&order=NEWEST',
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(evidence.reviewQueue).toHaveBeenCalledWith('user-123', {
      cursor: 'next-page',
      partition: 'TRAIN',
      status: ['CONFIRMED', 'CORRECTED'],
      fromAddress: 'notifications@github.com',
      subject: 'Aviso',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      order: 'NEWEST',
    });

    await request(app.getHttpServer())
      .get('/api/intelligence/review-queue?status=CONFIRMED&status=REJECTED')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(evidence.reviewQueue).toHaveBeenLastCalledWith('user-123', {
      status: ['CONFIRMED', 'REJECTED'],
    });

    await request(app.getHttpServer())
      .get(
        '/api/intelligence/review-queue?semanticType=FIN_TRANSACTION&route=FINANCE&confidenceMin=0.3&confidenceMax=0.6&order=IMPACT',
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(evidence.reviewQueue).toHaveBeenLastCalledWith('user-123', {
      semanticType: 'FIN_TRANSACTION',
      route: 'FINANCE',
      confidenceMin: 0.3,
      confidenceMax: 0.6,
      order: 'IMPACT',
    });

    await request(app.getHttpServer())
      .get('/api/intelligence/review-groups?page=2&pageSize=5')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(evidence.listReviewGroups).toHaveBeenCalledWith('user-123', {
      page: 2,
      pageSize: 5,
    });

    await request(app.getHttpServer())
      .post('/api/intelligence/review-groups/verifications')
      .set('Authorization', `Bearer ${token}`)
      .send({
        verdict: 'CONFIRMED',
        fromAddress: 'notifications@github.com',
        templateFingerprint: 'fp-github',
        semanticType: 'MARKETING',
      })
      .expect(201);
    expect(evidence.verifyReviewGroup).toHaveBeenCalledWith(
      'user-123',
      expect.objectContaining({
        verdict: 'CONFIRMED',
        fromAddress: 'notifications@github.com',
        templateFingerprint: 'fp-github',
        semanticType: 'MARKETING',
      }),
    );

    await request(app.getHttpServer())
      .post('/api/intelligence/messages/verifications/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({
        messageIds: ['message-1', 'message-2'],
        verdict: 'CONFIRMED',
        semanticType: 'MARKETING',
      })
      .expect(201);
    expect(evidence.verifyReviewSelection).toHaveBeenCalledWith(
      'user-123',
      expect.objectContaining({
        messageIds: ['message-1', 'message-2'],
        verdict: 'CONFIRMED',
        semanticType: 'MARKETING',
      }),
    );

    await request(app.getHttpServer())
      .post('/api/intelligence/messages/verifications/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({
        messageIds: Array.from(
          { length: 51 },
          (_, index) => `message-${index}`,
        ),
        verdict: 'CONFIRMED',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/intelligence/messages/verifications/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({
        messageIds: ['message-1', 'message-1'],
        verdict: 'CONFIRMED',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/intelligence/messages/message-1/verifications')
      .set('Authorization', `Bearer ${token}`)
      .send({ verdict: 'CONFIRMED' })
      .expect(201);
    expect(evidence.verifyMessage).toHaveBeenCalledWith(
      'user-123',
      'message-1',
      { verdict: 'CONFIRMED' },
    );

    await request(app.getHttpServer())
      .get('/api/intelligence/runs')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it.each([
    { semanticType: 'notificacion empleo' },
    { routes: ['FINANCE', 'FINANCE'] },
    { routes: ['TRAVEL'] },
    {
      semanticType: 'FIN_TRANSACTION',
      transaction: { kind: 'TRANSACTION', amount: -1 },
    },
    {
      semanticType: 'FIN_TRANSACTION',
      transaction: { kind: 'TRANSACTION', last4: '123' },
    },
    {
      semanticType: 'FIN_TRANSACTION',
      transaction: { kind: 'TRANSACTION', unknownField: 'x' },
    },
  ])('rejects an invalid label payload %# before persistence', async (body) => {
    evidence.verifyMessage.mockClear();
    await request(app.getHttpServer())
      .post('/api/intelligence/messages/message-1/verifications')
      .set('Authorization', `Bearer ${token}`)
      .send({ verdict: 'CORRECTED', ...body })
      .expect(400);
    expect(evidence.verifyMessage).not.toHaveBeenCalled();
  });

  it.each([
    { semanticType: 'NOT_A_TYPE' },
    { routes: ['TRAVEL'] },
    { verdict: 'REJECTED' },
    { fromAddress: '' },
    { templateFingerprint: 42 },
  ])(
    'rejects an invalid review group batch %# before persistence',
    async (body) => {
      evidence.verifyReviewGroup.mockClear();
      await request(app.getHttpServer())
        .post('/api/intelligence/review-groups/verifications')
        .set('Authorization', `Bearer ${token}`)
        .send({
          verdict: 'CONFIRMED',
          fromAddress: 'notifications@github.com',
          ...body,
        })
        .expect(400);
      expect(evidence.verifyReviewGroup).not.toHaveBeenCalled();
    },
  );

  it.each(['page=0', 'page=abc', 'pageSize=101'])(
    'rejects an invalid review groups page %#',
    async (query) => {
      evidence.listReviewGroups.mockClear();
      await request(app.getHttpServer())
        .get(`/api/intelligence/review-groups?${query}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
      expect(evidence.listReviewGroups).not.toHaveBeenCalled();
    },
  );

  it('accepts a batch without a template fingerprint and with a note', async () => {
    evidence.verifyReviewGroup.mockClear();
    await request(app.getHttpServer())
      .post('/api/intelligence/review-groups/verifications')
      .set('Authorization', `Bearer ${token}`)
      .send({
        verdict: 'CORRECTED',
        fromAddress: 'notifications@github.com',
        semanticType: 'OTHER',
        notes: 'Correo conocido',
      })
      .expect(201);
    expect(evidence.verifyReviewGroup).toHaveBeenCalledTimes(1);
  });

  it('accepts a typed financial transaction payload', async () => {
    evidence.verifyMessage.mockClear();
    await request(app.getHttpServer())
      .post('/api/intelligence/messages/message-1/verifications')
      .set('Authorization', `Bearer ${token}`)
      .send({
        verdict: 'CORRECTED',
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction: {
          kind: 'TRANSACTION',
          amount: 1250,
          currency: 'DOP',
          direction: 'DEBIT',
        },
      })
      .expect(201);
    expect(evidence.verifyMessage).toHaveBeenCalledTimes(1);
  });

  it('accepts a card payment correction with its account and card hints', async () => {
    evidence.verifyMessage.mockClear();
    await request(app.getHttpServer())
      .post('/api/intelligence/messages/message-1/verifications')
      .set('Authorization', `Bearer ${token}`)
      .send({
        verdict: 'CORRECTED',
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction: {
          kind: 'TRANSACTION',
          amount: 5200,
          currency: 'DOP',
          transactionDate: '2026-11-10T12:00:00.000Z',
          direction: 'DEBIT',
          movementClass: 'CARD_PAYMENT',
          last4: '4821',
          accountNumberLast4: '9012',
          suggestedTransactionDate: '2026-11-10T00:00:00.000Z',
          suggestedTransactionDateSource: 'EMAIL_HEADER',
          reverseOfBankReference: 'BHD-7700',
          reverseOfEmailMessageId: '18f0c2a9b7d34e56',
        },
      })
      .expect(201);
    expect(evidence.verifyMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    '?status=UNKNOWN',
    '?dateFrom=2026-13-01',
    '?dateTo=31-10-2026',
    '?order=SIDEWAYS',
    '?partition=OTHER',
    '?semanticType=UNKNOWN',
    '?route=UNKNOWN',
    '?confidenceMin=-0.1',
    '?confidenceMax=1.1',
    '?unknownFilter=1',
  ])('rejects the invalid review queue filter %s', async (query) => {
    evidence.reviewQueue.mockClear();

    await request(app.getHttpServer())
      .get(`/api/intelligence/review-queue${query}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(evidence.reviewQueue).not.toHaveBeenCalled();
  });

  it('publishes the exact label enums in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Test').setVersion('1').build(),
    );
    const verification = document.components?.schemas
      ?.CreateHumanVerificationDto as { properties: Record<string, never> };
    const transaction = document.components?.schemas
      ?.HumanVerificationTransactionDto as {
      properties: Record<string, never>;
    };

    expect(verification.properties.semanticType).toMatchObject({
      enum: [...SEMANTIC_TYPES],
    });
    expect(verification.properties.routes).toMatchObject({
      items: { enum: [...SEMANTIC_ROUTES] },
    });
    expect(transaction.properties.kind).toMatchObject({
      enum: [...TRANSACTION_KINDS],
    });
    expect(transaction.properties.direction).toMatchObject({
      enum: [...TRANSACTION_DIRECTIONS],
    });
    expect(transaction.properties.movementClass).toMatchObject({
      enum: [...TRANSACTION_MOVEMENT_CLASSES],
    });
    expect(transaction.properties.suggestedTransactionDateSource).toMatchObject(
      {
        enum: [...SUGGESTED_TRANSACTION_DATE_SOURCES],
      },
    );

    const reviewGroup = document.components?.schemas
      ?.CreateReviewGroupVerificationDto as {
      properties: Record<string, never>;
    };
    expect(reviewGroup.properties.verdict).toMatchObject({
      enum: [...REVIEW_GROUP_VERDICTS],
    });
    expect(reviewGroup.properties.semanticType).toMatchObject({
      enum: [...SEMANTIC_TYPES],
    });
    expect(reviewGroup.properties.fromAddress).toBeDefined();
    expect(
      document.paths?.['/api/intelligence/review-groups']?.get,
    ).toBeDefined();
    expect(
      document.paths?.['/api/intelligence/review-groups/verifications']?.post,
    ).toBeDefined();
    expect(
      document.paths?.['/api/intelligence/messages/verifications/batch']?.post,
    ).toBeDefined();
    const reviewSelection = document.components?.schemas
      ?.CreateReviewSelectionVerificationDto as {
      properties: Record<string, { maxItems?: number; uniqueItems?: boolean }>;
    };
    expect(reviewSelection.properties.messageIds).toMatchObject({
      maxItems: 20,
      uniqueItems: true,
    });
    expect(reviewSelection.properties.relevance).toBeDefined();
    expect(reviewSelection.properties.notes).toBeDefined();

    const reviewQueueParameters = (document.paths?.[
      '/api/intelligence/review-queue'
    ]?.get?.parameters ?? []) as Array<{
      name: string;
      schema?: Record<string, unknown>;
    }>;
    const reviewQueueParameter = (name: string) =>
      reviewQueueParameters.find((parameter) => parameter.name === name);
    expect(reviewQueueParameter('partition')?.schema).toMatchObject({
      enum: [...REVIEW_QUEUE_PARTITIONS],
    });
    expect(reviewQueueParameter('status')?.schema).toMatchObject({
      items: { enum: [...REVIEW_QUEUE_STATUSES] },
    });
    expect(reviewQueueParameter('order')?.schema).toMatchObject({
      enum: [...REVIEW_QUEUE_ORDERS],
    });
    expect(reviewQueueParameter('semanticType')?.schema).toMatchObject({
      enum: [...SEMANTIC_TYPES],
    });
    expect(reviewQueueParameter('route')?.schema).toMatchObject({
      enum: [...SEMANTIC_ROUTES],
    });
    expect(reviewQueueParameter('confidenceMin')?.schema).toBeDefined();
    expect(reviewQueueParameter('confidenceMax')?.schema).toBeDefined();
    expect(reviewQueueParameter('fromAddress')?.schema).toBeDefined();
    expect(reviewQueueParameter('subject')?.schema).toBeDefined();
    expect(reviewQueueParameter('dateFrom')?.schema).toBeDefined();
    expect(reviewQueueParameter('dateTo')?.schema).toBeDefined();

    const knowledge = document.components?.schemas?.KnowledgeItemDto as {
      properties: Record<string, never>;
    };
    expect(knowledge.properties.scope).toMatchObject({
      enum: ['GLOBAL', 'USER'],
    });
    expect(knowledge.properties.knowledgeType).toMatchObject({
      enum: [
        'EMAIL_SENDER',
        'EMAIL_DOMAIN',
        'EMAIL_TEMPLATE',
        'ENTITY',
        'RELATION',
        'USER_MAPPING',
      ],
    });
    expect(knowledge.properties.state).toMatchObject({
      enum: ['OBSERVED', 'STABLE', 'REVIEW_REQUIRED', 'BLOCKED'],
    });
    expect(
      document.paths?.['/api/intelligence/knowledge/admin/rebuild']?.post
        ?.responses?.['201'],
    ).toBeDefined();
    expect(
      document.paths?.['/api/intelligence/knowledge/me/export']?.get,
    ).toBeDefined();
    expect(
      document.paths?.['/api/intelligence/conversations']?.get,
    ).toBeDefined();
    expect(document.paths?.['/api/intelligence/actions']?.get).toBeDefined();
    expect(
      document.paths?.['/api/intelligence/actions/{actionId}/confirm']?.post,
    ).toBeDefined();
    expect(
      document.paths?.[
        '/api/intelligence/conversations/{conversationId}/messages'
      ]?.post,
    ).toBeDefined();
    const sendMessage = document.components?.schemas
      ?.SendAiConversationMessageDto as {
      properties: Record<string, never>;
    };
    expect(sendMessage.properties.content).toBeDefined();
  });
});
