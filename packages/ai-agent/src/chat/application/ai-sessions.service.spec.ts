import { NotFoundException } from '@nestjs/common';
import { AiSessionsService } from './ai-sessions.service';
import type { AiActionsService } from '../../actions/application/ai-actions.service';
import type { AiSessionsRepository } from '../infrastructure/ai-sessions.repository';
import type { AiActionSummary } from '../../shared/ai.types';

function createService() {
  const sessionsRepo = {
    findSessionsByUser: jest.fn().mockResolvedValue([]),
    findModuleBySlug: jest.fn(),
    createSessionWithModule: jest.fn(),
    findSessionById: jest.fn(),
    deleteSession: jest.fn(),
    deleteAllForUser: jest.fn(),
    countAllForUser: jest.fn(),
  };
  const actionsService = { listBySession: jest.fn().mockResolvedValue([]) };

  return {
    sessionsRepo,
    actionsService,
    service: new AiSessionsService(
      sessionsRepo as unknown as AiSessionsRepository,
      actionsService as unknown as AiActionsService,
    ),
  };
}

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    contextType: 'general',
    moduleId: null,
    chatContext: null,
    memorySnapshot: { title: 'Título guardado' },
    lastActiveAt: new Date('2026-10-16T10:00:00.000Z'),
    createdAt: new Date('2026-10-15T09:00:00.000Z'),
    module: null,
    messages: [],
    ...overrides,
  };
}

function actionSummary(
  overrides: Partial<AiActionSummary> = {},
): AiActionSummary {
  return {
    id: 'action-1',
    actionType: 'create_transaction',
    targetModule: 'finance',
    payload: {},
    status: 'pending',
    ...overrides,
  };
}

describe('AiSessionsService', () => {
  describe('list', () => {
    it('maps sessions with stored title, module slug and ISO dates', async () => {
      const { service, sessionsRepo } = createService();
      sessionsRepo.findSessionsByUser.mockResolvedValue([
        sessionRow({ module: { slug: 'finance' } }),
      ]);

      const page = await service.list('user-1', { limit: 20 });

      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
      expect(page.items).toEqual([
        {
          id: 'session-1',
          contextType: 'general',
          moduleId: null,
          moduleSlug: 'finance',
          chatContext: null,
          title: 'Título guardado',
          memorySnapshot: { title: 'Título guardado' },
          lastActiveAt: '2026-10-16T10:00:00.000Z',
          createdAt: '2026-10-15T09:00:00.000Z',
          preview: null,
        },
      ]);
    });

    it('falls back to the first message for title and preview', async () => {
      const { service, sessionsRepo } = createService();
      const longContent = 'x'.repeat(150);
      sessionsRepo.findSessionsByUser.mockResolvedValue([
        sessionRow({
          memorySnapshot: null,
          messages: [{ content: longContent }],
        }),
      ]);

      const page = await service.list('user-1', { limit: 20 });

      expect(page.items[0].title).toBe('x'.repeat(80));
      expect(page.items[0].preview).toBe('x'.repeat(120));
      expect(page.items[0].memorySnapshot).toEqual({});
    });

    it('marks more pages and returns the next cursor', async () => {
      const { service, sessionsRepo } = createService();
      sessionsRepo.findSessionsByUser.mockResolvedValue([
        sessionRow({ id: 'session-3' }),
        sessionRow({ id: 'session-2' }),
        sessionRow({ id: 'session-1' }),
      ]);

      const page = await service.list('user-1', { limit: 2 });

      expect(page.hasMore).toBe(true);
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toEqual(expect.any(String));
    });
  });

  describe('create', () => {
    it('creates a general session when no module is requested', async () => {
      const { service, sessionsRepo } = createService();
      sessionsRepo.createSessionWithModule.mockResolvedValue(sessionRow());

      const created = await service.create('user-1', {});

      expect(sessionsRepo.findModuleBySlug).not.toHaveBeenCalled();
      expect(sessionsRepo.createSessionWithModule).toHaveBeenCalledWith(
        'user-1',
        'general',
        null,
        undefined,
      );
      expect(created.messages).toEqual([]);
      expect(created.moduleSlug).toBeNull();
    });

    it('scopes the session to the requested module', async () => {
      const { service, sessionsRepo } = createService();
      sessionsRepo.findModuleBySlug.mockResolvedValue({ id: 'mod-1' });
      sessionsRepo.createSessionWithModule.mockResolvedValue(
        sessionRow({ contextType: 'finance' }),
      );

      await service.create('user-1', {
        context: { moduleSlug: 'finance' },
      });

      expect(sessionsRepo.findModuleBySlug).toHaveBeenCalledWith('finance');
      expect(sessionsRepo.createSessionWithModule).toHaveBeenCalledWith(
        'user-1',
        'finance',
        'mod-1',
        { moduleSlug: 'finance' },
      );
    });

    it('accepts the legacy top-level module slug', async () => {
      const { service, sessionsRepo } = createService();
      sessionsRepo.findModuleBySlug.mockResolvedValue({ id: 'mod-1' });
      sessionsRepo.createSessionWithModule.mockResolvedValue(sessionRow());

      await service.create('user-1', { moduleSlug: 'agenda' });

      expect(sessionsRepo.findModuleBySlug).toHaveBeenCalledWith('agenda');
      expect(sessionsRepo.createSessionWithModule).toHaveBeenCalledWith(
        'user-1',
        'agenda',
        'mod-1',
        undefined,
      );
    });

    it('rejects an unknown module', async () => {
      const { service, sessionsRepo } = createService();
      sessionsRepo.findModuleBySlug.mockResolvedValue(null);

      await expect(
        service.create('user-1', { context: { moduleSlug: 'ghost' } }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(sessionsRepo.createSessionWithModule).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('rejects a missing session', async () => {
      const { service, sessionsRepo } = createService();
      sessionsRepo.findSessionById.mockResolvedValue(null);

      await expect(
        service.getById('session-1', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('filters internal tool requests and empty messages', async () => {
      const { service, sessionsRepo } = createService();
      sessionsRepo.findSessionById.mockResolvedValue(
        sessionRow({
          messages: [
            {
              id: 'msg-user',
              role: 'user',
              content: 'hola',
              clientMessageId: null,
              metadata: {},
              createdAt: new Date('2026-10-16T10:00:00.000Z'),
            },
            {
              id: 'msg-tool-request',
              role: 'assistant',
              content: '[tool_calls]',
              clientMessageId: null,
              metadata: { phase: 'tool_request' },
              createdAt: new Date('2026-10-16T10:00:01.000Z'),
            },
            {
              id: 'msg-blank',
              role: 'assistant',
              content: '   ',
              clientMessageId: null,
              metadata: {},
              createdAt: new Date('2026-10-16T10:00:02.000Z'),
            },
            {
              id: 'msg-tool',
              role: 'tool',
              content: '',
              clientMessageId: null,
              metadata: {},
              createdAt: new Date('2026-10-16T10:00:03.000Z'),
            },
          ],
        }),
      );

      const session = await service.getById('session-1', 'user-1');

      expect(session.messages.map((message) => message.id)).toEqual([
        'msg-user',
        'msg-tool',
      ]);
      expect(session.messages[0].createdAt).toBe('2026-10-16T10:00:00.000Z');
    });

    it('recovers the client message id from metadata', async () => {
      const { service, sessionsRepo } = createService();
      sessionsRepo.findSessionById.mockResolvedValue(
        sessionRow({
          messages: [
            {
              id: 'msg-user',
              role: 'user',
              content: 'hola',
              clientMessageId: null,
              metadata: { clientMessageId: 'client-9' },
              createdAt: new Date('2026-10-16T10:00:00.000Z'),
            },
          ],
        }),
      );

      const session = await service.getById('session-1', 'user-1');

      expect(session.messages[0].clientMessageId).toBe('client-9');
    });

    it('refreshes stored actions and blocks with the live ones', async () => {
      const { service, sessionsRepo, actionsService } = createService();
      const liveAction = actionSummary({ status: 'executed' });
      actionsService.listBySession.mockResolvedValue([liveAction]);
      sessionsRepo.findSessionById.mockResolvedValue(
        sessionRow({
          messages: [
            {
              id: 'msg-assistant',
              role: 'assistant',
              content: 'hecho',
              clientMessageId: null,
              metadata: {
                actions: [actionSummary()],
                blocks: [
                  { type: 'action', action: actionSummary() },
                  { type: 'markdown', content: 'hola' },
                ],
              },
              createdAt: new Date('2026-10-16T10:00:00.000Z'),
            },
          ],
        }),
      );

      const session = await service.getById('session-1', 'user-1');
      const metadata = session.messages[0].metadata;

      expect(metadata.actions).toEqual([liveAction]);
      expect(metadata.blocks).toEqual([
        { type: 'action', action: liveAction },
        { type: 'markdown', content: 'hola' },
      ]);
    });
  });

  describe('delete', () => {
    it('rejects a session that does not belong to the user', async () => {
      const { service, sessionsRepo } = createService();
      sessionsRepo.deleteSession.mockResolvedValue({ count: 0 });

      await expect(
        service.delete('session-1', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('confirms the deletion', async () => {
      const { service, sessionsRepo } = createService();
      sessionsRepo.deleteSession.mockResolvedValue({ count: 1 });

      await expect(service.delete('session-1', 'user-1')).resolves.toEqual({
        success: true,
      });
    });
  });

  it('reports how many sessions were wiped', async () => {
    const { service, sessionsRepo } = createService();
    sessionsRepo.deleteAllForUser.mockResolvedValue({ count: 3 });

    await expect(service.wipeAllForUser('user-1')).resolves.toEqual({
      'ai.sessions': 3,
    });
  });

  it('counts the sessions it would wipe', async () => {
    const { service, sessionsRepo } = createService();
    sessionsRepo.countAllForUser.mockResolvedValue(5);

    await expect(service.countForUser('user-1')).resolves.toEqual({
      'ai.sessions': 5,
    });
  });
});
