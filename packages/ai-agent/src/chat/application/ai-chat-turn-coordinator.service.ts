import { Injectable, Logger } from '@nestjs/common';
import type { AgentRunResult, AgentStreamEvent } from '../../shared/ai.types';
import { replayStreamChunks } from '../../shared/replay-stream-chunks';

type TurnKey = string;

type InFlightTurn = {
  promise: Promise<AgentRunResult>;
};

@Injectable()
export class AiChatTurnCoordinator {
  private readonly logger = new Logger(AiChatTurnCoordinator.name);
  private readonly inFlight = new Map<TurnKey, InFlightTurn>();

  private buildKey(sessionId: string, clientMessageId?: string): TurnKey | null {
    if (!clientMessageId) {
      return null;
    }
    return `${sessionId}:${clientMessageId}`;
  }

  async run<T extends AgentRunResult>(
    input: { sessionId: string; clientMessageId?: string },
    execute: (onStream?: (event: AgentStreamEvent) => void) => Promise<T>,
    onStream?: (event: AgentStreamEvent) => void,
  ): Promise<T> {
    const key = this.buildKey(input.sessionId, input.clientMessageId);
    if (!key) {
      return execute(onStream);
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      this.logger.debug(
        `Joining in-flight turn sessionId=${input.sessionId} clientMessageId=${input.clientMessageId}`,
      );
      const result = (await existing.promise) as T;
      if (onStream && result.content) {
        onStream({
          type: 'start',
          sessionId: result.sessionId,
          provider: result.provider,
          model: result.model,
        });
        await replayStreamChunks(
          result.content,
          (chunk) => {
            onStream({ type: 'chunk', content: chunk });
          },
          { delayMs: 8 },
        );
      }
      return result;
    }

    this.logger.debug(
      `Starting turn sessionId=${input.sessionId} clientMessageId=${input.clientMessageId}`,
    );

    const promise = execute(onStream).finally(() => {
      this.inFlight.delete(key);
      this.logger.debug(
        `Finished turn sessionId=${input.sessionId} clientMessageId=${input.clientMessageId}`,
      );
    });

    this.inFlight.set(key, { promise });
    return promise;
  }
}
