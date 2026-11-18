import { summarizeEmailUsage } from './email-usage.service';

const day = new Date('2026-11-18T10:00:00.000Z');

const message = {
  id: 'message-1',
  fromDomain: 'bhd.com.do',
  processingStatus: 'PROCESSED',
};

describe('summarizeEmailUsage', () => {
  it('agrega por día, hora, banco y tipo', () => {
    const summary = summarizeEmailUsage({
      rows: [
        {
          provider: 'Groq',
          model: 'qwen/qwen3.8-27b',
          status: 'SUCCEEDED',
          inputTokens: 1000,
          outputTokens: 200,
          costUsd: 0.00032,
          sourceId: 'message-1',
          createdAt: day,
        },
        {
          provider: 'OpenRouter',
          model: 'deepseek/deepseek-v4-flash',
          status: 'FAILED',
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          sourceId: null,
          createdAt: new Date('2026-11-18T11:30:00.000Z'),
        },
      ],
      messages: [message],
      classificationTypes: new Map([['message-1', 'FIN_TRANSACTION']]),
    });

    expect(summary.totals).toEqual({
      calls: 2,
      succeeded: 1,
      failed: 1,
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.00032,
    });
    expect(summary.byDay).toEqual([
      expect.objectContaining({ day: '2026-11-18', calls: 2 }),
    ]);
    expect(summary.byHour).toEqual([
      expect.objectContaining({ hour: 10, calls: 1 }),
      expect.objectContaining({ hour: 11, calls: 1 }),
    ]);
    expect(summary.byBank).toEqual([
      {
        bank: 'bhd.com.do',
        calls: 1,
        inputTokens: 1000,
        outputTokens: 200,
        costUsd: 0.00032,
      },
      {
        bank: 'desconocido',
        calls: 1,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      },
    ]);
    expect(summary.byType).toEqual([
      expect.objectContaining({ type: 'FIN_TRANSACTION', calls: 1 }),
      expect.objectContaining({ type: 'SIN_CLASIFICACION', calls: 1 }),
    ]);
  });
});
