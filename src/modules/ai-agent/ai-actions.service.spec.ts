import {
    BadRequestException,
    ConflictException,
    NotFoundException,
} from '@nestjs/common';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { AiActionsRepository } from './ai-actions.repository';
import { AiActionsService } from './ai-actions.service';
import { ToolExecutorService } from './tools/tool-executor.service';

describe('AiActionsService', () => {
  const actionsRepo = {
    findById: jest.fn(),
    findBySession: jest.fn(),
    create: jest.fn(),
    claimForExecution: jest.fn(),
    claimForCancel: jest.fn(),
    updateStatus: jest.fn(),
  } as unknown as AiActionsRepository;

  const toolExecutor = {
    execute: jest.fn(),
  } as unknown as ToolExecutorService;

  const gateway = {
    emitToUser: jest.fn(),
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
          actionType: 'set_theme',
          payload: { value: 'neon' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(actionsRepo.create).not.toHaveBeenCalled();
    });

    it('stores validated payload', async () => {
      (actionsRepo.create as jest.Mock).mockResolvedValue({
        ...pendingAction,
      });

      await service.createPendingAction({
        sessionId: 'session-1',
        actionType: 'set_theme',
        payload: { value: 'dark' },
      });

      expect(actionsRepo.create).toHaveBeenCalledWith(
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
      (actionsRepo.findById as jest.Mock)
        .mockResolvedValueOnce(pendingAction)
        .mockResolvedValueOnce({ ...pendingAction, status: 'SUCCESS' });
      (actionsRepo.claimForExecution as jest.Mock).mockResolvedValue({
        ...pendingAction,
        status: 'RUNNING',
      });
      (toolExecutor.execute as jest.Mock).mockResolvedValue({
        success: true,
        message: 'Theme set to dark',
        sideEffects: [{ type: 'theme', value: 'dark' }],
      });

      const result = await service.execute('action-1', 'user-1');

      expect(actionsRepo.claimForExecution).toHaveBeenCalledWith(
        'action-1',
        'user-1',
      );
      expect(actionsRepo.updateStatus).toHaveBeenCalledWith(
        'action-1',
        'SUCCESS',
        expect.objectContaining({ message: 'Theme set to dark' }),
      );
      expect(result.action.status).toBe('SUCCESS');
      expect(gateway.emitToUser).toHaveBeenCalled();
    });

    it('returns conflict when claim loses the race', async () => {
      (actionsRepo.findById as jest.Mock)
        .mockResolvedValueOnce(pendingAction)
        .mockResolvedValueOnce({ ...pendingAction, status: 'RUNNING' });
      (actionsRepo.claimForExecution as jest.Mock).mockResolvedValue(null);

      await expect(service.execute('action-1', 'user-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(toolExecutor.execute).not.toHaveBeenCalled();
    });

    it('marks FAILED when executor throws unexpectedly', async () => {
      (actionsRepo.findById as jest.Mock)
        .mockResolvedValueOnce(pendingAction)
        .mockResolvedValueOnce({ ...pendingAction, status: 'FAILED' });
      (actionsRepo.claimForExecution as jest.Mock).mockResolvedValue({
        ...pendingAction,
        status: 'RUNNING',
      });
      (toolExecutor.execute as jest.Mock).mockRejectedValue(
        new Error('boom'),
      );

      const result = await service.execute('action-1', 'user-1');

      expect(actionsRepo.updateStatus).toHaveBeenCalledWith(
        'action-1',
        'FAILED',
        expect.objectContaining({
          message: expect.stringContaining('boom'),
        }),
      );
      expect(result.action.status).toBe('FAILED');
    });

    it('rejects non-pending without claiming', async () => {
      (actionsRepo.findById as jest.Mock).mockResolvedValue({
        ...pendingAction,
        status: 'SUCCESS',
      });

      await expect(service.execute('action-1', 'user-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(actionsRepo.claimForExecution).not.toHaveBeenCalled();
    });

    it('throws not found for missing action', async () => {
      (actionsRepo.findById as jest.Mock).mockResolvedValue(null);

      await expect(service.execute('missing', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('cancel', () => {
    it('cancels via conditional claim', async () => {
      (actionsRepo.findById as jest.Mock).mockResolvedValue(pendingAction);
      (actionsRepo.claimForCancel as jest.Mock).mockResolvedValue({
        ...pendingAction,
        status: 'CANCELLED',
      });

      const summary = await service.cancel('action-1', 'user-1');
      expect(summary.status).toBe('CANCELLED');
      expect(actionsRepo.claimForCancel).toHaveBeenCalledWith(
        'action-1',
        'user-1',
      );
    });

    it('conflicts when cancel loses race to execute', async () => {
      (actionsRepo.findById as jest.Mock)
        .mockResolvedValueOnce(pendingAction)
        .mockResolvedValueOnce({ ...pendingAction, status: 'RUNNING' });
      (actionsRepo.claimForCancel as jest.Mock).mockResolvedValue(null);

      await expect(service.cancel('action-1', 'user-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
