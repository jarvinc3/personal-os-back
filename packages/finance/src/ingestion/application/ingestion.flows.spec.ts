import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EmailSourceService } from './email-source.service';
import { GmailSyncQueueService } from './gmail-sync-queue.service';
import { IngestionService } from './ingestion.service';

jest.mock('../infrastructure/token-encryption.util', () => ({
  decryptToken: jest.fn(() => 'access-token'),
  encryptToken: jest.fn(() => 'encrypted-token'),
}));

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

const sourceRow = {
  id: 'src-1',
  connectionId: 'conn-1',
  institutionId: 'inst-1',
  institution: { name: 'Banco Uno' },
  connection: { emailAddress: 'user@gmail.com', provider: 'gmail' },
  bankSenderEmails: ['avisos@banco.com'],
  bankDomain: 'banco.com',
  label: 'Principal',
  isActive: true,
  lastSyncedAt: null,
  createdAt: CREATED_AT,
  logs: [],
};

const pendingAmountMessage = {
  id: 'em-1',
  sourceId: 'src-1',
  gmailMessageId: 'msg-1',
  outcome: 'PENDING_AMOUNT' as const,
  instrumentHint: 'ACCOUNT',
  lastFourHint: null,
  accountNumberHint: null,
  extractedPayload: {
    currency: 'DOP',
    type: 'DEBIT' as const,
    transactionDate: '2026-08-01',
    description: 'Coffee',
    merchant: 'Cafe',
  },
  provider: 'groq',
  model: 'test',
  reason: null,
  createdAt: CREATED_AT,
  source: {
    institutionId: 'inst-1',
    connection: { emailAddress: 'user@gmail.com' },
    institution: { name: 'Banco Uno' },
  },
  transaction: null,
};

function createService() {
  const repo = {
    listMailboxes: jest.fn(),
    deactivateMailbox: jest.fn(),
    findEmailSource: jest.fn(),
    findSourceByUserAndInstitution: jest.fn(),
    updateEmailSource: jest.fn(),
    findEmailMessageById: jest.fn(),
    listInstitutionDestinations: jest.fn(),
    upsertEmailMessage: jest.fn(),
    listCategories: jest.fn().mockResolvedValue([]),
    findEmailSourceForRefresh: jest.fn(),
  };
  const users = {
    assertFinanceEmailSyncEnabled: jest.fn().mockResolvedValue(undefined),
  };
  const ownership = {
    assertInstitutionAcceptsBankProducts: jest
      .fn()
      .mockResolvedValue(undefined),
    assertAccountOwned: jest.fn().mockResolvedValue({
      id: 'acc-1',
      institutionId: 'inst-1',
      isActive: true,
    }),
    assertCardOwned: jest.fn(),
  };
  const importEmail = { execute: jest.fn().mockResolvedValue({ id: 'tx-1' }) };
  const outboxDispatcher = { processBatch: jest.fn() };

  return {
    repo,
    importEmail,
    service: new IngestionService(
      repo as never,
      { get: jest.fn(() => 'encryption-key') } as never,
      { enqueue: jest.fn() },
      outboxDispatcher as never,
      users as never,
      ownership as never,
      importEmail as never,
      {
        findLatestCategoryIdByMerchant: jest.fn().mockResolvedValue(null),
      } as never,
      new EmailSourceService(
        repo as never,
        users as never,
        ownership as never,
        new GmailSyncQueueService(undefined),
      ),
      new GmailSyncQueueService(undefined),
    ),
  };
}

describe('IngestionService mailboxes and sources', () => {
  it('lists mailboxes with their linked sources', async () => {
    const { service, repo } = createService();
    repo.listMailboxes.mockResolvedValue([
      {
        id: 'box-1',
        emailAddress: 'user@gmail.com',
        provider: 'gmail',
        isActive: true,
        createdAt: CREATED_AT,
        sources: [sourceRow],
      },
    ]);

    const boxes = await service.listMailboxes('user-1');

    expect(boxes).toEqual([
      {
        id: 'box-1',
        emailAddress: 'user@gmail.com',
        provider: 'gmail',
        isActive: true,
        createdAt: CREATED_AT.toISOString(),
        sources: [
          expect.objectContaining({
            id: 'src-1',
            institutionName: 'Banco Uno',
            bankSenderEmail: 'avisos@banco.com',
            emailAddress: 'user@gmail.com',
          }),
        ],
      },
    ]);
  });

  it('rejects deactivating an unknown mailbox', async () => {
    const { service, repo } = createService();
    repo.deactivateMailbox.mockResolvedValue(null);

    await expect(
      service.deactivateMailbox('user-1', 'box-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deactivates a mailbox', async () => {
    const { service, repo } = createService();
    repo.deactivateMailbox.mockResolvedValue({ id: 'box-1' });

    await expect(service.deactivateMailbox('user-1', 'box-1')).resolves.toEqual(
      {
        success: true,
      },
    );
  });

  it('rejects updating an unknown source', async () => {
    const { service, repo } = createService();
    repo.findEmailSource.mockResolvedValue(null);

    await expect(
      service.updateEmailSource('user-1', 'src-1', { label: 'Nuevo' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects linking an institution already owned by another mailbox', async () => {
    const { service, repo } = createService();
    repo.findEmailSource.mockResolvedValue(sourceRow);
    repo.findSourceByUserAndInstitution.mockResolvedValue({
      id: 'src-2',
      isActive: true,
    });

    await expect(
      service.updateEmailSource('user-1', 'src-1', { institutionId: 'inst-2' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.updateEmailSource).not.toHaveBeenCalled();
  });

  it('updates the sender list keeping the shared domain', async () => {
    const { service, repo } = createService();
    repo.findEmailSource.mockResolvedValue(sourceRow);
    repo.updateEmailSource.mockResolvedValue(sourceRow);

    await service.updateEmailSource('user-1', 'src-1', {
      bankSenderEmail: 'nuevo@banco.com',
    });

    expect(repo.updateEmailSource).toHaveBeenCalledWith('user-1', 'src-1', {
      bankSenderEmails: ['nuevo@banco.com'],
      bankDomain: 'banco.com',
    });
  });

  it('rejects sender emails from different domains', async () => {
    const { service, repo } = createService();
    repo.findEmailSource.mockResolvedValue(sourceRow);

    await expect(
      service.updateEmailSource('user-1', 'src-1', {
        bankSenderEmails: ['a@uno.com', 'b@dos.com'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates only the bank domain when no sender is given', async () => {
    const { service, repo } = createService();
    repo.findEmailSource.mockResolvedValue(sourceRow);
    repo.updateEmailSource.mockResolvedValue(sourceRow);

    await service.updateEmailSource('user-1', 'src-1', {
      bankDomain: '  otro.com  ',
    });

    expect(repo.updateEmailSource).toHaveBeenCalledWith('user-1', 'src-1', {
      bankDomain: 'otro.com',
    });
  });

  it('reports a source that disappeared during the update', async () => {
    const { service, repo } = createService();
    repo.findEmailSource.mockResolvedValue(sourceRow);
    repo.updateEmailSource.mockResolvedValue(null);

    await expect(
      service.updateEmailSource('user-1', 'src-1', { label: 'Nuevo' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deactivates a source', async () => {
    const { service, repo } = createService();
    repo.updateEmailSource.mockResolvedValue(sourceRow);

    await expect(
      service.deactivateEmailSource('user-1', 'src-1'),
    ).resolves.toEqual({ success: true });
    expect(repo.updateEmailSource).toHaveBeenCalledWith('user-1', 'src-1', {
      isActive: false,
    });
  });

  it('rejects triggering an unknown source', async () => {
    const { service, repo } = createService();
    repo.findEmailSource.mockResolvedValue(null);

    await expect(
      service.triggerEmailSync('user-1', 'src-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a refresh when the source has no access token', async () => {
    const { service, repo } = createService();
    repo.findEmailSourceForRefresh.mockResolvedValue(null);

    await expect(
      service.getValidGmailAccessToken('src-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns a decrypted token that is still valid', async () => {
    const { service, repo } = createService();
    repo.findEmailSourceForRefresh.mockResolvedValue({
      connection: {
        accessToken: 'encrypted',
        tokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    await expect(service.getValidGmailAccessToken('src-1')).resolves.toBe(
      'access-token',
    );
  });

  it('rejects adding senders to an unknown source', async () => {
    const { service, repo } = createService();
    repo.findEmailSource.mockResolvedValue(null);

    await expect(
      service.addSourceSenders('user-1', 'src-1', ['nuevo@banco.com']),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('adds senders and returns the updated source', async () => {
    const { service, repo } = createService();
    repo.findEmailSource.mockResolvedValue(sourceRow);
    repo.updateEmailSource.mockResolvedValue({
      ...sourceRow,
      bankSenderEmails: ['avisos@banco.com', 'nuevo@banco.com'],
    });

    const updated = await service.addSourceSenders('user-1', 'src-1', [
      'nuevo@banco.com',
    ]);

    expect(repo.updateEmailSource).toHaveBeenCalledWith('user-1', 'src-1', {
      bankSenderEmails: ['avisos@banco.com', 'nuevo@banco.com'],
      bankDomain: 'banco.com',
    });
    expect(updated.bankSenderEmails).toEqual([
      'avisos@banco.com',
      'nuevo@banco.com',
    ]);
  });

  it('rejects senders that do not share the bank domain', async () => {
    const { service, repo } = createService();
    repo.findEmailSource.mockResolvedValue(sourceRow);

    await expect(
      service.addSourceSenders('user-1', 'src-1', ['otro@otro.com']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('IngestionService.completePendingAmount', () => {
  it('rejects an unknown message', async () => {
    const { service, repo } = createService();
    repo.findEmailMessageById.mockResolvedValue(null);

    await expect(
      service.completePendingAmount('user-1', 'em-1', 10),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the imported transaction when the message is already imported', async () => {
    const { service, repo } = createService();
    repo.findEmailMessageById.mockResolvedValue({
      ...pendingAmountMessage,
      outcome: 'IMPORTED',
      transaction: { id: 'tx-9' },
    });

    await expect(
      service.completePendingAmount('user-1', 'em-1', 10),
    ).resolves.toEqual({ assigned: true, transactionId: 'tx-9' });
  });

  it('rejects a message that is not waiting for an amount', async () => {
    const { service, repo } = createService();
    repo.findEmailMessageById.mockResolvedValue({
      ...pendingAmountMessage,
      outcome: 'PENDING_ASSIGNMENT',
    });

    await expect(
      service.completePendingAmount('user-1', 'em-1', 10),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-positive amount', async () => {
    const { service, repo } = createService();
    repo.findEmailMessageById.mockResolvedValue(pendingAmountMessage);

    await expect(
      service.completePendingAmount('user-1', 'em-1', 0),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the message pending when the target is still ambiguous', async () => {
    const { service, repo } = createService();
    repo.findEmailMessageById
      .mockResolvedValueOnce(pendingAmountMessage)
      .mockResolvedValueOnce({
        ...pendingAmountMessage,
        outcome: 'PENDING_ASSIGNMENT',
        extractedPayload: {
          ...pendingAmountMessage.extractedPayload,
          amount: 10,
        },
      });
    repo.listInstitutionDestinations.mockResolvedValue([[], []]);

    const agentResult = await service.completePendingAmount(
      'user-1',
      'em-1',
      10,
    );

    expect(repo.upsertEmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'PENDING_ASSIGNMENT',
        extractedPayload: expect.objectContaining({ amount: 10 }),
      }),
    );
    expect(agentResult).toMatchObject({ id: 'em-1' });
  });

  it('imports the message when the amount completes a unique target', async () => {
    const { service, repo, importEmail } = createService();
    repo.findEmailMessageById.mockResolvedValue({
      ...pendingAmountMessage,
      accountNumberHint: '5678',
    });
    repo.listInstitutionDestinations.mockResolvedValue([
      [
        { id: 'acc-1', accountNumberLast4: '5678' },
        { id: 'acc-2', accountNumberLast4: '0000' },
      ],
      [],
    ]);

    await expect(
      service.completePendingAmount('user-1', 'em-1', 10),
    ).resolves.toEqual({ assigned: true, transactionId: 'tx-1' });
    expect(importEmail.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ accountId: 'acc-1', amount: 10 }),
    );
  });
});

describe('IngestionService.listDiscoveredSenders', () => {
  it('rejects an unknown source before touching Gmail', async () => {
    const { service, repo } = createService();
    repo.findEmailSource.mockResolvedValue(null);

    await expect(
      service.listDiscoveredSenders('user-1', 'src-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
