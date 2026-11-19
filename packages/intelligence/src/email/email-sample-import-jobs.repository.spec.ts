import { EmailSampleImportJobsRepository } from './email-sample-import-jobs.repository';

function setup({ claimed = 1 } = {}) {
  const prisma = {
    aiEmailSampleImport: {
      create: jest.fn().mockResolvedValue({ id: 'job-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ id: 'job-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: claimed }),
    },
  };
  const repo = new EmailSampleImportJobsRepository(prisma as never);
  return { prisma, repo };
}

function firstUpdate(prisma: ReturnType<typeof setup>['prisma']) {
  return prisma.aiEmailSampleImport.updateMany.mock.calls[0] as [
    {
      where: unknown;
      data: { status: string; processed: number; startedAt: Date };
    },
  ];
}

describe('EmailSampleImportJobsRepository', () => {
  it('creates the job with the selected ids as its total', async () => {
    const { prisma, repo } = setup();

    await repo.create({
      userId: 'user-1',
      dryRun: true,
      selectionMode: 'IDS',
      messageIds: ['message-1', 'message-2'],
      sender: null,
      dateFrom: null,
      dateTo: null,
    });

    expect(prisma.aiEmailSampleImport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          selectionMode: 'IDS',
          messageIds: ['message-1', 'message-2'],
          total: 2,
        }),
      }),
    );
  });

  it('claims only a queued job', async () => {
    const { prisma, repo } = setup();

    const claimed = await repo.claim('job-1');

    const [claim] = firstUpdate(prisma);
    expect(claim.where).toEqual({ id: 'job-1', status: 'QUEUED' });
    expect(claim.data.status).toBe('RUNNING');
    expect(claim.data.processed).toBe(0);
    expect(claim.data.startedAt).toBeInstanceOf(Date);
    expect(claimed).toEqual({ id: 'job-1' });
  });

  it('leaves a job that is already running or finished alone', async () => {
    const { repo } = setup({ claimed: 0 });

    expect(await repo.claim('job-1')).toBeNull();
  });

  it('closes only a running job', async () => {
    const { prisma, repo } = setup();

    await repo.complete('job-1', { dryRun: true });
    await repo.fail('job-1', 'SAMPLE_IMPORT_FAILED');

    const calls = prisma.aiEmailSampleImport.updateMany.mock.calls as Array<
      [{ where: unknown; data: { status: string; error?: string | null } }]
    >;
    expect(calls[0][0].where).toEqual({ id: 'job-1', status: 'RUNNING' });
    expect(calls[0][0].data.status).toBe('COMPLETED');
    expect(calls[1][0].data).toMatchObject({
      status: 'FAILED',
      error: 'SAMPLE_IMPORT_FAILED',
    });
  });
});
