import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AiService } from '../src/modules/ai-agent/chat/application/ai.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { applyAuthTestOverrides } from './helpers/auth-test.providers';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock } from './helpers/prisma.mock';
import { applyTestEnv } from './helpers/test-env';

applyTestEnv();

describe('AI Agent (e2e)', () => {
  let app: INestApplication<App>;
  let prismaMock: ReturnType<typeof createPrismaMock> & {
    aiAgentSession: Record<string, jest.Mock>;
    aiAction: Record<string, jest.Mock>;
    aiMessage: Record<string, jest.Mock>;
  };
  let token: string;
  let chatCompleteStreamCalls = 0;

  const session = {
    id: 'session-1',
    userId: 'user-123',
    moduleId: null,
    contextType: 'general',
    memorySnapshot: {},
    lastActiveAt: new Date(),
    createdAt: new Date(),
    module: null,
    messages: [] as unknown[],
  };

  const pendingAction = {
    id: 'action-1',
    sessionId: 'session-1',
    messageId: null,
    actionType: 'set_theme',
    targetModule: 'core',
    payload: { value: 'dark' },
    status: 'PENDING',
    result: null,
    executedAt: null,
  };

  beforeEach(async () => {
    chatCompleteStreamCalls = 0;
    const { AppModule } = require('../src/app.module') as {
      AppModule: new (...args: never[]) => unknown;
    };
    const base = createPrismaMock();
    prismaMock = {
      ...base,
      aiAgentSession: {
        create: jest.fn().mockResolvedValue(session),
        findFirst: jest.fn().mockResolvedValue({
          ...session,
          messages: [],
        }),
        findUnique: jest.fn().mockResolvedValue(session),
        update: jest.fn().mockResolvedValue(session),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      aiMessage: {
        create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: `msg-${Date.now()}`,
            createdAt: new Date(),
            ...args.data,
          }),
        ),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      aiAction: {
        create: jest.fn().mockResolvedValue(pendingAction),
        findFirst: jest.fn().mockResolvedValue(pendingAction),
        findMany: jest.fn().mockResolvedValue([pendingAction]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
          Promise.resolve({
            ...pendingAction,
            ...args.data,
            status: args.data.status ?? 'SUCCESS',
          }),
        ),
      },
    };

    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'test@example.com',
      fullName: 'Test User',
      avatarUrl: null,
      timezone: 'UTC',
      locale: 'es',
      preferences: {
        ai: {
          confirmBeforeActions: true,
          proactiveInsights: true,
          tone: 'balanced',
          defaultProvider: null,
        },
      },
      userModules: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prismaMock.user.update.mockResolvedValue({
      id: 'user-123',
      preferences: { theme: 'dark' },
    });

    token = createTestJwt({ sub: 'user-123' });

    const aiServiceMock = {
      getProviders: () => [{ name: 'mock', model: 'mock-model', available: true }],
      chatCompleteStream: jest.fn(() => {
        chatCompleteStreamCalls += 1;
        if (chatCompleteStreamCalls === 1) {
          return Promise.resolve({
            provider: 'mock',
            model: 'mock-model',
            content: '',
            toolCalls: [
              {
                id: 'call_1',
                name: 'set_theme',
                arguments: { value: 'dark' },
              },
            ],
          });
        }
        return Promise.resolve({
          provider: 'mock',
          model: 'mock-model',
          content: 'Theme change is pending your confirmation.',
          toolCalls: [],
        });
      }),
      chatComplete: jest.fn(),
      chat: jest.fn(),
    };

    const moduleFixture: TestingModule = await applyAuthTestOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(prismaMock)
        .overrideProvider(AiService)
        .useValue(aiServiceMock),
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

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('POST /api/ai/chat stages mutating tool then execute succeeds', async () => {
    const chatRes = await request(app.getHttpServer())
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        messages: [{ role: 'user', content: 'cambia el tema a dark' }],
      })
      .expect(201);

    expect(chatRes.body.data ?? chatRes.body).toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        requiresConfirmation: true,
        actions: expect.arrayContaining([
          expect.objectContaining({
            id: 'action-1',
            actionType: 'set_theme',
            status: 'PENDING',
          }),
        ]),
      }),
    );

    const execRes = await request(app.getHttpServer())
      .post('/api/ai/actions/action-1/execute')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(execRes.body.data ?? execRes.body).toEqual(
      expect.objectContaining({
        action: expect.objectContaining({
          id: 'action-1',
          actionType: 'set_theme',
        }),
      }),
    );
  });
});
