import type { DomainEventIdempotencyGuard } from '@personal-os/core';
import type { NotificationsGateway } from '../presentation/notifications.gateway';
import { NotificationsEventsListener } from './notifications-events.listener';

describe('NotificationsEventsListener', () => {
  const emitToUser = jest.fn();
  const tryClaim = jest.fn().mockResolvedValue(true);
  const listener = new NotificationsEventsListener(
    { tryClaim } as unknown as DomainEventIdempotencyGuard,
    { emitToUser } as unknown as NotificationsGateway,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards the email sync state to the user socket', () => {
    listener.onAiEmailSyncUpdated({
      userId: 'user-1',
      state: { phase: 'IDLE' },
    });

    expect(emitToUser).toHaveBeenCalledWith('user-1', 'ai.email.sync.updated', {
      state: { phase: 'IDLE' },
    });
  });

  it('claims a wiped user without creating notifications', async () => {
    await listener.onUserDataWiped({
      eventId: 'evt-wiped',
      userId: 'user-1',
    });

    expect(tryClaim).toHaveBeenCalledWith(
      'evt-wiped',
      'notifications:data-wiped',
    );
  });
});
