import {
  DEFAULT_DAILY_INSIGHT_QUOTA,
  resolveDailyInsightQuota,
} from './ai-limits';
import { AiProcessingProcessor } from './ai-processing.processor';

describe('AiProcessingProcessor quota + session reuse', () => {
  const chatComplete = jest.fn();
  const emitToUser = jest.fn();
  const findById = jest.fn();
  const countInsightMessagesSince = jest.fn();
  const findLatestInsightSession = jest.fn();
  const createSessionWithModule = jest.fn();
  const touchSession = jest.fn();
  const createMessage = jest.fn();
  const maybeSummarizeSession = jest.fn();

  const processor = new AiProcessingProcessor(
    { chatComplete } as never,
    { emitToUser } as never,
    { findById } as never,
    {
      countInsightMessagesSince,
      findLatestInsightSession,
      createSessionWithModule,
      touchSession,
      createMessage,
    } as never,
    { maybeSummarizeSession } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findById.mockResolvedValue({
      id: 'user-1',
      locale: 'es',
      timezone: 'UTC',
      preferences: { ai: { proactiveInsights: true } },
    });
    countInsightMessagesSince.mockResolvedValue(0);
    findLatestInsightSession.mockResolvedValue(null);
    createSessionWithModule.mockResolvedValue({ id: 'session-new' });
    chatComplete.mockResolvedValue({
      provider: 'mock',
      model: 'mock-model',
      content: 'Hello insight',
    });
    createMessage.mockResolvedValue({ id: 'msg-1' });
  });

  it('skips insight when daily quota is exhausted', async () => {
    countInsightMessagesSince.mockResolvedValue(DEFAULT_DAILY_INSIGHT_QUOTA);

    await processor.process({
      data: {
        userId: 'user-1',
        actionType: 'user.logged_in',
        payload: {},
      },
    } as never);

    expect(chatComplete).not.toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('reuses latest insight session when present', async () => {
    findLatestInsightSession.mockResolvedValue({ id: 'session-existing' });

    await processor.process({
      data: {
        userId: 'user-1',
        actionType: 'module.enabled',
        payload: { slug: 'finance' },
      },
    } as never);

    expect(createSessionWithModule).not.toHaveBeenCalled();
    expect(touchSession).toHaveBeenCalledWith('session-existing');
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-existing',
        metadata: expect.objectContaining({ source: 'insight' }),
      }),
    );
    expect(resolveDailyInsightQuota()).toBeGreaterThan(0);
  });
});
