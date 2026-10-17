import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { NotificationsGateway } from '@personal-os/notifications';
import { AiActionsRepository } from '../infrastructure/ai-actions.repository';
import { AiActionsService } from './ai-actions.service';
import { ToolExecutorService } from '../../tools/tool-executor.service';

describe('AiActionsService', () => {
  const findById = jest.fn();
  const findBySession = jest.fn();
  const create = jest.fn();
  const claimForExecution = jest.fn();
  const claimForCancel = jest.fn();
  const updateStatus = jest.fn();
  const actionsRepo = {
    findById,
    findBySession,
    create,
    claimForExecution,
    claimForCancel,
    updateStatus,
  } as unknown as AiActionsRepository;

  const execute = jest.fn();
  const toolExecutor = {
    execute,
  } as unknown as ToolExecutorService;

  const emitToUser = jest.fn();
  const gateway = {
    emitToUser,
  } as unknown as NotificationsGateway;

  const service = new AiActionsService(actionsRepo, toolExecutor, gateway);

  const pendingAction = {
    id: 'action-1',
    sessionId: 'session-1',
    actionType: 'set_theme',
    targetModule: 'core',
    payload: { value: 'dark' },
    status: 'PENDING',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createPendingAction', () => {
    it('rejects invalid mutating payload before persist', async () => {
      await expect(
        service.createPendingAction({
          sessionId: 'session-1',
          userId: 'user-1',
          actionType: 'set_theme',
          payload: { value: 'neon' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(create.mock.calls).toHaveLength(0);
    });

    it('stores validated payload', async () => {
      create.mockResolvedValue({
        ...pendingAction,
      });

      await service.createPendingAction({
        sessionId: 'session-1',
        userId: 'user-1',
        actionType: 'set_theme',
        payload: { value: 'dark' },
      });

      expect(create.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          actionType: 'set_theme',
          payload: { value: 'dark' },
          status: 'PENDING',
        }),
      );
    });
  });

  describe('execute', () => {
    it('claims pending action once and finalizes success', async () => {
      findById
        .mockResolvedValueOnce(pendingAction)
        .mockResolvedValueOnce({ ...pendingAction, status: 'SUCCESS' });
      claimForExecution.mockResolvedValue({
        ...pendingAction,
        status: 'RUNNING',
      });
      execute.mockResolvedValue({
        success: true,
        message: 'Theme set to dark',
        sideEffects: [{ type: 'theme', value: 'dark' }],
      });

      const result = await service.execute('action-1', 'user-1');

      expect(claimForExecution.mock.calls).toEqual([['action-1', 'user-1']]);
      expect(updateStatus.mock.calls[0]).toEqual([
        'action-1',
        'SUCCESS',
        expect.objectContaining({ message: 'Theme set to dark' }),
      ]);
      expect(result.action.status).toBe('SUCCESS');
      expect(emitToUser.mock.calls.length).toBeGreaterThan(0);
    });

    it('returns conflict when claim loses the race', async () => {
      findById
        .mockResolvedValueOnce(pendingAction)
        .mockResolvedValueOnce({ ...pendingAction, status: 'RUNNING' });
      claimForExecution.mockResolvedValue(null);

      await expect(
        service.execute('action-1', 'user-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(execute.mock.calls).toHaveLength(0);
    });

    it('marks FAILED when executor throws unexpectedly', async () => {
      findById
        .mockResolvedValueOnce(pendingAction)
        .mockResolvedValueOnce({ ...pendingAction, status: 'FAILED' });
      claimForExecution.mockResolvedValue({
        ...pendingAction,
        status: 'RUNNING',
      });
      execute.mockRejectedValue(new Error('boom'));

      const result = await service.execute('action-1', 'user-1');

      expect(updateStatus.mock.calls[0]).toEqual([
        'action-1',
        'FAILED',
        expect.objectContaining({
          message: expect.stringContaining('boom'),
        }),
      ]);
      expect(result.action.status).toBe('FAILED');
    });

    it('rejects non-pending without claiming', async () => {
      findById.mockResolvedValue({
        ...pendingAction,
        status: 'SUCCESS',
      });

      await expect(
        service.execute('action-1', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(claimForExecution.mock.calls).toHaveLength(0);
    });

    it('throws not found for missing action', async () => {
      findById.mockResolvedValue(null);

      await expect(service.execute('missing', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('cancel', () => {
    it('cancels via conditional claim', async () => {
      findById.mockResolvedValue(pendingAction);
      claimForCancel.mockResolvedValue({
        ...pendingAction,
        status: 'CANCELLED',
      });

      const summary = await service.cancel('action-1', 'user-1');
      expect(summary.status).toBe('CANCELLED');
      expect(claimForCancel.mock.calls).toEqual([['action-1', 'user-1']]);
    });

    it('conflicts when cancel loses race to execute', async () => {
      findById
        .mockResolvedValueOnce(pendingAction)
        .mockResolvedValueOnce({ ...pendingAction, status: 'RUNNING' });
      claimForCancel.mockResolvedValue(null);

      await expect(service.cancel('action-1', 'user-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
