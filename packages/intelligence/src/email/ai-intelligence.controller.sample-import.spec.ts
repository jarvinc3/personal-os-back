import { NotFoundException } from '@nestjs/common';
import { TIMEOUT_MS_KEY } from '@personal-os/core';
import { AiIntelligenceController } from './ai-intelligence.controller';
import type { EmailSampleImportService } from './email-sample-import.service';

const startedJob = {
  id: 'job-1',
  status: 'QUEUED',
  dryRun: true,
  progress: { processed: 0, total: 1 },
  result: null,
  error: null,
  createdAt: '2026-11-19T10:00:00.000Z',
  startedAt: null,
  finishedAt: null,
};

function makeController({
  nodeEnv,
  startResult = startedJob,
  statusResult = startedJob,
}: {
  nodeEnv: string;
  startResult?: Record<string, unknown>;
  statusResult?: Record<string, unknown>;
}) {
  const sampleImport = {
    start: jest.fn().mockResolvedValue(startResult),
    getForUser: jest.fn().mockResolvedValue(statusResult),
  };
  const config = {
    get: jest.fn((key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined)),
  };
  const controller = new AiIntelligenceController(
    {} as never,
    {} as never,
    sampleImport as unknown as EmailSampleImportService,
    config as never,
  );
  return { controller, sampleImport };
}

const previewRequest = {
  dryRun: true,
  selection: { messageIds: ['message-1'] },
};

describe('AiIntelligenceController sample import', () => {
  it('does not hold the sample import request open while it runs', () => {
    const timeoutFor = (method: string) => {
      const handler: unknown = Object.getOwnPropertyDescriptor(
        AiIntelligenceController.prototype,
        method,
      )?.value;
      return typeof handler === 'function'
        ? Reflect.getMetadata(TIMEOUT_MS_KEY, handler)
        : undefined;
    };

    expect(timeoutFor('sampleImportRun')).toBeUndefined();
    expect(timeoutFor('sampleImportStatus')).toBeUndefined();
    expect(timeoutFor('messages')).toBeUndefined();
  });

  it('does not expose the pilot routes in production', () => {
    const { controller, sampleImport } = makeController({
      nodeEnv: 'production',
    });

    expect(() =>
      controller.sampleImportRun({ sub: 'user-1' }, previewRequest),
    ).toThrow(NotFoundException);
    expect(() =>
      controller.sampleImportStatus({ sub: 'user-1' }, 'job-1'),
    ).toThrow(NotFoundException);
    expect(sampleImport.start).not.toHaveBeenCalled();
    expect(sampleImport.getForUser).not.toHaveBeenCalled();
  });

  it('starts the job with the selection and converts the dates', async () => {
    const { controller, sampleImport } = makeController({ nodeEnv: 'test' });

    const started = await controller.sampleImportRun(
      { sub: 'user-1' },
      {
        dryRun: false,
        selection: {
          sender: 'bhd.com.do',
          dateFrom: '2026-10-26T00:00:00.000Z',
          dateTo: '2026-11-02T23:59:59.999Z',
        },
      },
    );

    expect(sampleImport.start).toHaveBeenCalledWith({
      userId: 'user-1',
      dryRun: false,
      selection: {
        messageIds: undefined,
        sender: 'bhd.com.do',
        dateFrom: new Date('2026-10-26T00:00:00.000Z'),
        dateTo: new Date('2026-11-02T23:59:59.999Z'),
      },
    });
    expect(started).toMatchObject({ id: 'job-1', status: 'QUEUED' });
  });

  it('returns the state of a job for its owner', async () => {
    const { controller, sampleImport } = makeController({
      nodeEnv: 'test',
      statusResult: { ...startedJob, status: 'RUNNING' },
    });

    const status = await controller.sampleImportStatus(
      { sub: 'user-1' },
      'job-1',
    );

    expect(sampleImport.getForUser).toHaveBeenCalledWith('user-1', 'job-1');
    expect(status).toMatchObject({ id: 'job-1', status: 'RUNNING' });
  });
});
