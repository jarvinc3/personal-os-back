import { NotFoundException } from '@nestjs/common';
import { TIMEOUT_MS_KEY } from '@personal-os/core';
import { AiIntelligenceController } from './ai-intelligence.controller';
import type { EmailSampleImportService } from './email-sample-import.service';

function makeController({
  nodeEnv,
  runResult = { dryRun: true },
}: {
  nodeEnv: string;
  runResult?: Record<string, unknown>;
}) {
  const sampleImport = {
    run: jest.fn().mockResolvedValue(runResult),
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
  it('gives only the sample import route a three-minute timeout', () => {
    const timeoutFor = (method: string) => {
      const handler: unknown = Object.getOwnPropertyDescriptor(
        AiIntelligenceController.prototype,
        method,
      )?.value;
      return typeof handler === 'function'
        ? Reflect.getMetadata(TIMEOUT_MS_KEY, handler)
        : undefined;
    };

    expect(timeoutFor('sampleImportRun')).toBe(180_000);
    expect(timeoutFor('messages')).toBeUndefined();
  });

  it('does not expose the pilot route in production', () => {
    const { controller, sampleImport } = makeController({
      nodeEnv: 'production',
    });

    expect(() =>
      controller.sampleImportRun({ sub: 'user-1' }, previewRequest),
    ).toThrow(NotFoundException);
    expect(sampleImport.run).not.toHaveBeenCalled();
  });

  it('delegates the selection and converts the dates', async () => {
    const { controller, sampleImport } = makeController({ nodeEnv: 'test' });

    await controller.sampleImportRun(
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

    expect(sampleImport.run).toHaveBeenCalledWith({
      userId: 'user-1',
      dryRun: false,
      selection: {
        messageIds: undefined,
        sender: 'bhd.com.do',
        dateFrom: new Date('2026-10-26T00:00:00.000Z'),
        dateTo: new Date('2026-11-02T23:59:59.999Z'),
      },
    });
  });
});
