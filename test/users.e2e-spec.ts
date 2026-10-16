import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { SupabaseAdminService } from '@personal-os/auth';
import { PrismaService } from '@personal-os/database';
import { applyAuthTestOverrides } from './helpers/auth-test.providers';
import { createTestJwt } from './helpers/jwt.helper';
import { createPrismaMock, type PrismaMock } from './helpers/prisma.mock';
import { applyTestEnv } from './helpers/test-env';

applyTestEnv();

describe('Users (e2e)', () => {
  let app: INestApplication<App>;
  let prismaMock: PrismaMock;
  const tryDeleteAuthUserMock = jest.fn().mockResolvedValue({ ok: true });

  beforeEach(async () => {
    tryDeleteAuthUserMock.mockClear();
    tryDeleteAuthUserMock.mockResolvedValue({ ok: true });

    const { AppModule } = require('../apps/api/src/app.module') as {
      AppModule: new (...args: never[]) => unknown;
    };
    prismaMock = createPrismaMock();

    const moduleFixture: TestingModule = await applyAuthTestOverrides(
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
});
