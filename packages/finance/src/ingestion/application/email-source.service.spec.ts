import type { EmailSourceRepository } from '../infrastructure/email-source.repository';
import { EmailSourceService } from './email-source.service';
import { GmailSyncQueueService } from './gmail-sync-queue.service';

describe('EmailSourceService mailbox linking', () => {
  const findConnectionByUserEmail = jest.fn();
  const findSourceByUserAndInstitution = jest.fn();
  const createEmailSource = jest.fn();
  const updateEmailSource = jest.fn();
  const listMailboxes = jest.fn();
  const deactivateMailbox = jest.fn();
  const repo = {
    findConnectionByUserEmail,
    findSourceByUserAndInstitution,
    createEmailSource,
    updateEmailSource,
    listMailboxes,
    deactivateMailbox,
  } as unknown as EmailSourceRepository;

  const users = {
    assertFinanceEmailSyncEnabled: jest.fn().mockResolvedValue(undefined),
    isFinanceEmailSyncAutomatic: jest.fn().mockResolvedValue(false),
  };
  const ownership = {
    assertInstitutionOwned: jest.fn().mockResolvedValue(undefined),
    assertInstitutionAcceptsBankProducts: jest
      .fn()
      .mockResolvedValue(undefined),
  };

  const service = new EmailSourceService(
    repo,
    users as never,
    ownership as never,
    new GmailSyncQueueService(undefined),
  );

  const mappedSource = {
    id: 'src-1',
    connectionId: 'conn-1',
    institutionId: 'inst-1',
    institution: { name: 'BHD' },
    bankSenderEmails: ['alertas@bhd.com.do'],
    bankDomain: 'bhd.com.do',
    label: null,
    isActive: true,
    lastSyncedAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    logs: [],
    connection: {
      emailAddress: 'me@gmail.com',
      provider: 'gmail',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    users.assertFinanceEmailSyncEnabled.mockResolvedValue(undefined);
    users.isFinanceEmailSyncAutomatic.mockResolvedValue(false);
    ownership.assertInstitutionOwned.mockResolvedValue(undefined);
  });

  it('refuses to create a source without an authorized mailbox', async () => {
    findConnectionByUserEmail.mockResolvedValue(null);
    await expect(
      service.createEmailSource('user-1', {
        emailAddress: 'me@gmail.com',
        bankSenderEmail: 'alertas@bhd.com.do',
        institutionId: 'inst-1',
      }),
    ).rejects.toThrow('Conecta Gmail antes de vincular un banco');
  });

  it('refuses to create a source when the mailbox has no refresh token', async () => {
    findConnectionByUserEmail.mockResolvedValue({
      id: 'conn-1',
      refreshToken: null,
    });
    await expect(
      service.createEmailSource('user-1', {
        emailAddress: 'me@gmail.com',
        bankSenderEmail: 'alertas@bhd.com.do',
        institutionId: 'inst-1',
      }),
    ).rejects.toThrow('Conecta Gmail primero');
  });

  it('creates a source from sender email and derives the domain', async () => {
    findConnectionByUserEmail.mockResolvedValue({
      id: 'conn-1',
      refreshToken: 'enc',
    });
    findSourceByUserAndInstitution.mockResolvedValue(null);
    createEmailSource.mockResolvedValue(mappedSource);

    await expect(
      service.createEmailSource('user-1', {
        emailAddress: 'me@gmail.com',
        bankSenderEmail: 'alertas@bhd.com.do',
        institutionId: 'inst-1',
      }),
    ).resolves.toMatchObject({
      bankSenderEmail: 'alertas@bhd.com.do',
      bankDomain: 'bhd.com.do',
    });
    expect(createEmailSource).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        connectionId: 'conn-1',
        bankSenderEmails: ['alertas@bhd.com.do'],
        bankDomain: 'bhd.com.do',
      }),
    );
  });

  it('enqueues an incremental Gmail sync when automatic sync is on', async () => {
    const add = jest.fn().mockResolvedValue({});
    users.isFinanceEmailSyncAutomatic.mockResolvedValue(true);
    const queuedService = new EmailSourceService(
      repo,
      users as never,
      ownership as never,
      new GmailSyncQueueService({ add } as never),
    );
    findConnectionByUserEmail.mockResolvedValue({
      id: 'conn-1',
      refreshToken: 'enc',
    });
    findSourceByUserAndInstitution.mockResolvedValue(null);
    createEmailSource.mockResolvedValue(mappedSource);

    await queuedService.createEmailSource('user-1', {
      emailAddress: 'me@gmail.com',
      bankSenderEmail: 'alertas@bhd.com.do',
      institutionId: 'inst-1',
    });

    expect(add).toHaveBeenCalledWith(
      'gmail-sync-source',
      { userId: 'user-1', sourceId: 'src-1', forceFullSync: false },
      expect.objectContaining({ jobId: 'gmail-sync-src-1' }),
    );
  });

  it('does not enqueue on link when automatic sync is off', async () => {
    const add = jest.fn().mockResolvedValue({});
    const queuedService = new EmailSourceService(
      repo,
      users as never,
      ownership as never,
      new GmailSyncQueueService({ add } as never),
    );
    findConnectionByUserEmail.mockResolvedValue({
      id: 'conn-1',
      refreshToken: 'enc',
    });
    findSourceByUserAndInstitution.mockResolvedValue(null);
    createEmailSource.mockResolvedValue(mappedSource);

    await queuedService.createEmailSource('user-1', {
      emailAddress: 'me@gmail.com',
      bankSenderEmail: 'alertas@bhd.com.do',
      institutionId: 'inst-1',
    });

    expect(add).not.toHaveBeenCalled();
  });

  it('conflicts when the institution is already linked to another mailbox', async () => {
    findConnectionByUserEmail.mockResolvedValue({
      id: 'conn-2',
      refreshToken: 'enc',
    });
    findSourceByUserAndInstitution.mockResolvedValue({
      ...mappedSource,
      connectionId: 'conn-1',
      isActive: true,
    });

    await expect(
      service.createEmailSource('user-1', {
        emailAddress: 'other@gmail.com',
        bankSenderEmail: 'alertas@bhd.com.do',
        institutionId: 'inst-1',
      }),
    ).rejects.toThrow('This institution is already linked to a mailbox');
  });
});
