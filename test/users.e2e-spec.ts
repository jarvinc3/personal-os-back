import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { SupabaseAdminService } from '@personal-os/auth';
import { PrismaService } from '@personal-os/database';
import { applyE2eTestOverrides } from './helpers/e2e-test.providers';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock, type PrismaMock } from './helpers/prisma.mock';

// Loaded at file scope so the one-time ts-jest transpile of the app graph
// does not consume the 5s hook timeout on a cold cache (#150).
const { AppModule } = require('../apps/api/src/app.module') as {
  AppModule: new (...args: never[]) => unknown;
};

describe('Users (e2e)', () => {
  let app: INestApplication<App>;
  let prismaMock: PrismaMock;
  const tryDeleteAuthUserMock = jest.fn().mockResolvedValue({ ok: true });

  beforeEach(async () => {
    tryDeleteAuthUserMock.mockClear();
    tryDeleteAuthUserMock.mockResolvedValue({ ok: true });

    prismaMock = createPrismaMock();

    const moduleFixture: TestingModule = await applyE2eTestOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(prismaMock)
        .overrideProvider(SupabaseAdminService)
        .useValue({
          deleteAuthUser: jest.fn(),
          tryDeleteAuthUser: tryDeleteAuthUserMock,
        }),
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

  it('GET /api/users/me returns profile when user exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      fullName: 'User Test',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      avatarUrl: null,
      preferences: {},
      lastSeenReleaseVersion: '0.38.1',
      userModules: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const token = createTestJwt({ sub: 'user-123', email: 'user@example.com' });

    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          data: {
            id: 'user-123',
            lastSeenReleaseVersion: '0.38.1',
          },
          meta: {
            path: '/api/users/me',
          },
        });
      });
  });

  it('GET /api/users/me returns 404 when user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const token = createTestJwt({ sub: 'missing-user' });

    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(404)
      .expect((res) => {
        expect(res.body).toMatchObject({
          statusCode: 404,
          message: 'Usuario no encontrado',
          path: '/api/users/me',
        });
      });
  });

  it('PATCH /api/users/me updates partial profile and returns envelope', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      fullName: 'User Test',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      avatarUrl: null,
      preferences: {},
      userModules: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    prismaMock.user.update.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      fullName: 'Updated Name',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      avatarUrl: null,
      preferences: {
        theme: 'dark',
      },
      userModules: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const token = createTestJwt({ sub: 'user-123', email: 'user@example.com' });

    await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Updated Name',
        preferences: { theme: 'dark' },
      })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          data: {
            fullName: 'Updated Name',
            preferences: {
              theme: 'dark',
            },
          },
          meta: {
            path: '/api/users/me',
          },
        });
      });
  });

  it('PATCH /api/users/me/release-notes-seen stores the seen version', async () => {
    const timestamp = new Date('2026-01-01T00:00:00.000Z');
    const profileRow = {
      id: 'user-123',
      email: 'user@example.com',
      fullName: 'User Test',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      avatarUrl: null,
      preferences: {},
      lastSeenReleaseVersion: null,
      userModules: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    prismaMock.user.findUnique
      .mockResolvedValueOnce(profileRow)
      .mockResolvedValueOnce({
        ...profileRow,
        lastSeenReleaseVersion: '0.39.0',
      });

    const token = createTestJwt({ sub: 'user-123', email: 'user@example.com' });

    await request(app.getHttpServer())
      .patch('/api/users/me/release-notes-seen')
      .set('Authorization', `Bearer ${token}`)
      .send({ version: '0.39.0' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.lastSeenReleaseVersion).toBe('0.39.0');
        expect(res.body.meta.path).toBe('/api/users/me/release-notes-seen');
      });

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-123' },
      data: { lastSeenReleaseVersion: '0.39.0' },
    });
  });

  it('PATCH /api/users/me/release-notes-seen rejects a malformed version', async () => {
    const token = createTestJwt({ sub: 'user-123', email: 'user@example.com' });

    await request(app.getHttpServer())
      .patch('/api/users/me/release-notes-seen')
      .set('Authorization', `Bearer ${token}`)
      .send({ version: 'v0.39' })
      .expect(400);

    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/users/me/release-notes-seen returns 404 without a user row', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const token = createTestJwt({ sub: 'missing-user' });

    await request(app.getHttpServer())
      .patch('/api/users/me/release-notes-seen')
      .set('Authorization', `Bearer ${token}`)
      .send({ version: '0.39.0' })
      .expect(404);

    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/users/me/modules/finance upserts module config', async () => {
    const enabledAt = new Date('2026-01-01T00:00:00.000Z');
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      fullName: 'User Test',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      avatarUrl: null,
      preferences: {},
      userModules: [],
      createdAt: enabledAt,
      updatedAt: enabledAt,
    });
    prismaMock.module.findUnique.mockResolvedValue({
      id: 'mod-finance',
      slug: 'finance',
      name: 'Finanzas',
      key: 'fin',
      isActive: true,
      sortOrder: 0,
      description: null,
    });
    prismaMock.userModule.findUnique.mockResolvedValue(null);
    prismaMock.userModule.upsert.mockResolvedValue({
      id: 'um-1',
      userId: 'user-123',
      moduleId: 'mod-finance',
      isEnabled: true,
      config: { baseCurrency: 'USD' },
      enabledAt,
      module: { slug: 'finance' },
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      fullName: 'User Test',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      avatarUrl: null,
      preferences: {},
      userModules: [
        {
          isEnabled: true,
          config: { baseCurrency: 'USD', fieldGuide: 'test' },
          enabledAt,
          module: { slug: 'finance' },
        },
      ],
      createdAt: enabledAt,
      updatedAt: enabledAt,
    });

    const token = createTestJwt({ sub: 'user-123', email: 'user@example.com' });

    await request(app.getHttpServer())
      .patch('/api/users/me/modules/finance')
      .set('Authorization', `Bearer ${token}`)
      .send({ config: { baseCurrency: 'USD' } })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.userModules).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              slug: 'finance',
              isEnabled: true,
            }),
          ]),
        );
      });
  });

  it('PATCH /api/users/me/modules/ai rejects an out-of-range review threshold', async () => {
    const enabledAt = new Date('2026-01-01T00:00:00.000Z');
    prismaMock.module.findUnique.mockResolvedValue({
      id: 'mod-ai',
      slug: 'ai',
      name: 'Inteligencia',
      key: 'ai',
      isActive: true,
      sortOrder: 1,
      description: null,
    });
    prismaMock.userModule.findUnique.mockResolvedValue({
      id: 'um-ai',
      userId: 'user-123',
      moduleId: 'mod-ai',
      isEnabled: true,
      config: {
        email: {
          reviewConfidenceThreshold: 0.7,
          acceptVerifiedSenders: false,
        },
      },
      enabledAt,
      module: { slug: 'ai' },
    });

    const token = createTestJwt({ sub: 'user-123', email: 'user@example.com' });

    await request(app.getHttpServer())
      .patch('/api/users/me/modules/ai')
      .set('Authorization', `Bearer ${token}`)
      .send({ config: { email: { reviewConfidenceThreshold: 1.2 } } })
      .expect(400);

    expect(prismaMock.userModule.upsert).not.toHaveBeenCalled();
  });

  it('PATCH /api/users/me/modules/finance rejects an out-of-range reminder window', async () => {
    const enabledAt = new Date('2026-01-01T00:00:00.000Z');
    prismaMock.module.findUnique.mockResolvedValue({
      id: 'mod-finance',
      slug: 'finance',
      name: 'Finanzas',
      key: 'fin',
      isActive: true,
      sortOrder: 0,
      description: null,
    });
    prismaMock.userModule.findUnique.mockResolvedValue({
      id: 'um-finance',
      userId: 'user-123',
      moduleId: 'mod-finance',
      isEnabled: true,
      config: { reminders: { cardDueDaysBefore: 3 } },
      enabledAt,
      module: { slug: 'finance' },
    });

    const token = createTestJwt({ sub: 'user-123', email: 'user@example.com' });

    await request(app.getHttpServer())
      .patch('/api/users/me/modules/finance')
      .set('Authorization', `Bearer ${token}`)
      .send({ config: { reminders: { cardDueDaysBefore: 31 } } })
      .expect(400);

    expect(prismaMock.userModule.upsert).not.toHaveBeenCalled();
  });

  it('PATCH /api/users/me/modules/finance toggles isEnabled without changing config', async () => {
    const enabledAt = new Date('2026-01-01T00:00:00.000Z');
    const existingConfig = { baseCurrency: 'DOP', version: 1 };

    prismaMock.module.findUnique.mockResolvedValue({
      id: 'mod-finance',
      slug: 'finance',
      name: 'Finanzas',
      key: 'fin',
      isActive: true,
      sortOrder: 0,
      description: null,
    });
    prismaMock.userModule.findUnique.mockResolvedValue({
      id: 'um-1',
      userId: 'user-123',
      moduleId: 'mod-finance',
      isEnabled: true,
      config: existingConfig,
      enabledAt,
      module: { slug: 'finance' },
    });
    prismaMock.userModule.upsert.mockResolvedValue({
      id: 'um-1',
      userId: 'user-123',
      moduleId: 'mod-finance',
      isEnabled: false,
      config: existingConfig,
      enabledAt,
      module: { slug: 'finance' },
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      fullName: 'User Test',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      avatarUrl: null,
      preferences: {},
      userModules: [
        {
          isEnabled: false,
          config: existingConfig,
          enabledAt,
          module: { slug: 'finance' },
        },
      ],
      createdAt: enabledAt,
      updatedAt: enabledAt,
    });

    const token = createTestJwt({ sub: 'user-123', email: 'user@example.com' });

    await request(app.getHttpServer())
      .patch('/api/users/me/modules/finance')
      .set('Authorization', `Bearer ${token}`)
      .send({ isEnabled: false })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.userModules).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              slug: 'finance',
              isEnabled: false,
              config: existingConfig,
            }),
          ]),
        );
        expect(prismaMock.userModule.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({
              isEnabled: false,
              config: expect.objectContaining({ baseCurrency: 'DOP' }),
            }),
          }),
        );
      });
  });

  it('PATCH /api/users/me/modules/finance enables module without config patch', async () => {
    const enabledAt = new Date('2026-01-01T00:00:00.000Z');
    const existingConfig = { baseCurrency: 'DOP', version: 1 };

    prismaMock.module.findUnique.mockResolvedValue({
      id: 'mod-finance',
      slug: 'finance',
      name: 'Finanzas',
      key: 'fin',
      isActive: true,
      sortOrder: 0,
      description: null,
    });
    prismaMock.userModule.findUnique.mockResolvedValue({
      id: 'um-1',
      userId: 'user-123',
      moduleId: 'mod-finance',
      isEnabled: false,
      config: existingConfig,
      enabledAt,
      module: { slug: 'finance' },
    });
    prismaMock.userModule.upsert.mockResolvedValue({
      id: 'um-1',
      userId: 'user-123',
      moduleId: 'mod-finance',
      isEnabled: true,
      config: existingConfig,
      enabledAt,
      module: { slug: 'finance' },
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      fullName: 'User Test',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      avatarUrl: null,
      preferences: {},
      userModules: [
        {
          isEnabled: true,
          config: existingConfig,
          enabledAt,
          module: { slug: 'finance' },
        },
      ],
      createdAt: enabledAt,
      updatedAt: enabledAt,
    });

    const token = createTestJwt({ sub: 'user-123', email: 'user@example.com' });

    await request(app.getHttpServer())
      .patch('/api/users/me/modules/finance')
      .set('Authorization', `Bearer ${token}`)
      .send({ isEnabled: true })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.userModules).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              slug: 'finance',
              isEnabled: true,
            }),
          ]),
        );
      });
  });

  it('DELETE /api/users/me deletes account when user exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      fullName: 'User Test',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      avatarUrl: null,
      preferences: {},
      userModules: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    prismaMock.authDeletionOutbox.update.mockResolvedValue({ id: 'oob-1' });

    const token = createTestJwt({ sub: 'user-123', email: 'user@example.com' });

    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({
          success: true,
          authCleanupPending: false,
        });
        expect(res.body.meta).toEqual(
          expect.objectContaining({
            path: '/api/users/me',
          }),
        );
      });

    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(tryDeleteAuthUserMock).toHaveBeenCalledWith('user-123');
    expect(prismaMock.authDeletionOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-123' },
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });

  it('DELETE /api/users/me returns authCleanupPending when Auth wipe fails', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      fullName: 'Test User',
      avatarUrl: null,
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      preferences: {},
      userModules: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    tryDeleteAuthUserMock.mockResolvedValue({
      ok: false,
      message: 'temporary outage',
      retryable: true,
    });

    const token = createTestJwt({ sub: 'user-123', email: 'user@example.com' });

    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({
          success: true,
          authCleanupPending: true,
        });
      });

    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(tryDeleteAuthUserMock).toHaveBeenCalledWith('user-123');
    expect(prismaMock.authDeletionOutbox.update).not.toHaveBeenCalled();
  });

  it('DELETE /api/users/me returns 404 when user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const token = createTestJwt({
      sub: 'missing-user',
      email: 'missing@example.com',
    });

    await request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(404)
      .expect((res) => {
        expect(res.body.message).toBe('Usuario no encontrado');
        expect(res.body.path).toBe('/api/users/me');
      });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tryDeleteAuthUserMock).not.toHaveBeenCalled();
  });

  it('DELETE /api/users/me returns 401 without token', async () => {
    await request(app.getHttpServer()).delete('/api/users/me').expect(401);
  });
  describe('data branches', () => {
    const token = () => createTestJwt({ sub: 'user-123' });
    const userWithFinance = {
      id: 'user-123',
      email: 'user@example.com',
      fullName: 'User Test',
      timezone: 'America/Santo_Domingo',
      locale: 'es-DO',
      avatarUrl: null,
      preferences: { theme: 'dark' },
      lastSeenReleaseVersion: '0.38.1',
      userModules: [{ isEnabled: true, module: { slug: 'finance' } }],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    beforeEach(() => {
      prismaMock.user.findUnique.mockResolvedValue(userWithFinance);
    });

    it('GET /api/users/me/data/branches groups the branches by app with counts', async () => {
      prismaMock.finTransaction.count.mockResolvedValue(7);

      await request(app.getHttpServer())
        .get('/api/users/me/data/branches')
        .set('Authorization', `Bearer ${token()}`)
        .expect(200)
        .expect((res) => {
          const apps = res.body.data.map((group: { app: string }) => group.app);
          expect(apps).toEqual(['finance', 'ai', 'notifications', 'settings']);
          const transactionBranch = res.body.data[0].branches.find(
            (branch: { id: string }) => branch.id === 'finance.transactions',
          );
          expect(transactionBranch.count).toBe(7);
          const ai = res.body.data.find(
            (group: { app: string }) => group.app === 'ai',
          );
          const inferenceBranch = ai.branches.find(
            (branch: { id: string }) => branch.id === 'ai.inferences',
          );
          expect(inferenceBranch).toMatchObject({
            id: 'ai.inferences',
            count: 0,
          });
          const settings = res.body.data.at(-1);
          expect(settings.branches[0].count).toBe(1);
        });
    });

    it('POST /api/users/me/data/wipe rejects the retired AI history branch', async () => {
      await request(app.getHttpServer())
        .post('/api/users/me/data/wipe')
        .set('Authorization', `Bearer ${token()}`)
        .send({ branches: ['ai.sessions'] })
        .expect(400);
    });

    it('POST /api/users/me/data/wipe deletes the users inference telemetry', async () => {
      prismaMock.aiInference.deleteMany.mockResolvedValue({ count: 3 });

      await request(app.getHttpServer())
        .post('/api/users/me/data/wipe')
        .set('Authorization', `Bearer ${token()}`)
        .send({ branches: ['ai.inferences'] })
        .expect(200)
        .expect((res) => {
          expect(res.body.data).toMatchObject({
            requestedBranches: ['ai.inferences'],
            appliedBranches: ['ai.inferences'],
            counts: { 'ai.inferences': 3 },
          });
        });
      expect(prismaMock.aiInference.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
    });

    it('POST /api/users/me/data/wipe deletes the users AI action audit', async () => {
      prismaMock.aiAction.deleteMany.mockResolvedValue({ count: 2 });

      await request(app.getHttpServer())
        .post('/api/users/me/data/wipe')
        .set('Authorization', `Bearer ${token()}`)
        .send({ branches: ['ai.actions'] })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.counts).toEqual({ 'ai.actions': 2 });
        });
      expect(prismaMock.aiAction.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
    });

    it('POST /api/users/me/data/wipe deletes the users view suggestions', async () => {
      prismaMock.aiViewSuggestion.deleteMany.mockResolvedValue({ count: 5 });

      await request(app.getHttpServer())
        .post('/api/users/me/data/wipe')
        .set('Authorization', `Bearer ${token()}`)
        .send({ branches: ['ai.viewSuggestions'] })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.counts).toEqual({ 'ai.viewSuggestions': 5 });
        });
      expect(prismaMock.aiViewSuggestion.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
    });

    it('POST /api/users/me/data/wipe rejects a branch that does not exist', async () => {
      await request(app.getHttpServer())
        .post('/api/users/me/data/wipe')
        .set('Authorization', `Bearer ${token()}`)
        .send({ branches: ['finance.unknown'] })
        .expect(400);
    });
    it('POST /api/users/me/data/wipe expands the finance branches they drag', async () => {
      prismaMock.finTransaction.deleteMany.mockResolvedValue({ count: 2 });
      prismaMock.finReconciliation.deleteMany.mockResolvedValue({ count: 1 });

      await request(app.getHttpServer())
        .post('/api/users/me/data/wipe')
        .set('Authorization', `Bearer ${token()}`)
        .send({ branches: ['finance.transactions'] })
        .expect(200)
        .expect((res) => {
          expect(res.body.data.appliedBranches).toEqual([
            'finance.reconciliations',
            'finance.transactions',
          ]);
          expect(res.body.data.counts).toEqual({
            'finance.reconciliations': 1,
            'finance.transactions': 2,
          });
        });

      expect(prismaMock.$transaction).toHaveBeenCalled();
    });
  });
});
