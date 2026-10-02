import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import type { EmailSyncJob } from '@personal-os/core';
import { EmailSyncProcessor } from './email-sync.processor';

describe('EmailSyncProcessor', () => {
  const usersRepository = {
    findById: jest.fn(),
  };
  const emailSender = {
    send: jest.fn().mockResolvedValue(undefined),
  };

  function createProcessor(deliveryEnabled: boolean) {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'EMAIL_DELIVERY_ENABLED') {
          return deliveryEnabled;
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    return new EmailSyncProcessor(
      config as never,
      usersRepository as never,
      emailSender,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends via EmailSenderPort when delivery is enabled and to is set', async () => {
    const processor = createProcessor(true);
    const job = {
      id: 'job-1',
      data: {
        userId: 'u1',
        template: 'notification',
        to: 'user@example.com',
        subject: 'Hello',
        body: 'World',
      },
    } as Job<EmailSyncJob>;

    await processor.process(job);

    expect(emailSender.send).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Hello',
      text: 'World',
    });
    expect(usersRepository.findById).not.toHaveBeenCalled();
  });

  it('resolves recipient from user profile when to is empty', async () => {
    usersRepository.findById.mockResolvedValue({
      id: 'u1',
      email: 'profile@example.com',
    });
    const processor = createProcessor(true);
    const job = {
      id: 'job-2',
      data: {
        userId: 'u1',
        template: 'notification',
        to: '',
        subject: 'Hello',
        body: 'World',
      },
    } as Job<EmailSyncJob>;

    await processor.process(job);

    expect(usersRepository.findById).toHaveBeenCalledWith('u1');
    expect(emailSender.send).toHaveBeenCalledWith({
      to: 'profile@example.com',
      subject: 'Hello',
      text: 'World',
    });
  });

  it('skips when delivery flag is off', async () => {
    const processor = createProcessor(false);
    const job = {
      id: 'job-3',
      data: {
        userId: 'u1',
        template: 'notification',
        to: 'user@example.com',
        subject: 'Hello',
        body: 'World',
      },
    } as Job<EmailSyncJob>;

    await processor.process(job);

    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it('skips when no recipient email is available', async () => {
    usersRepository.findById.mockResolvedValue({ id: 'u1', email: null });
    const processor = createProcessor(true);
    const job = {
      id: 'job-4',
      data: {
        userId: 'u1',
        template: 'notification',
        to: '  ',
        subject: 'Hello',
        body: 'World',
      },
    } as Job<EmailSyncJob>;

    await processor.process(job);

    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it('skips when subject is empty', async () => {
    const processor = createProcessor(true);
    const job = {
      id: 'job-5',
      data: {
        userId: 'u1',
        template: 'notification',
        to: 'user@example.com',
        subject: '   ',
        body: 'World',
      },
    } as Job<EmailSyncJob>;

    await processor.process(job);

    expect(emailSender.send).not.toHaveBeenCalled();
  });
});
