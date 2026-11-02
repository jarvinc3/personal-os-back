import { ConflictException } from '@nestjs/common';

export const AI_SIGNAL_STATUSES = [
  'DETECTED',
  'VALIDATED',
  'ROUTED',
  'CONSUMED',
  'DISMISSED',
  'SUPERSEDED',
  'FAILED',
] as const;
export type AiSignalStatus = (typeof AI_SIGNAL_STATUSES)[number];

const NEXT_STATUSES: Record<AiSignalStatus, readonly AiSignalStatus[]> = {
  DETECTED: ['VALIDATED', 'DISMISSED', 'FAILED'],
  VALIDATED: ['ROUTED', 'DISMISSED', 'FAILED'],
  ROUTED: ['CONSUMED', 'DISMISSED', 'SUPERSEDED', 'FAILED'],
  CONSUMED: [],
  DISMISSED: [],
  SUPERSEDED: [],
  FAILED: [],
};

export function assertAiSignalTransition(
  current: AiSignalStatus,
  next: AiSignalStatus,
): void {
  if (!NEXT_STATUSES[current].includes(next)) {
    throw new ConflictException(
      `Transición de señal no permitida: ${current} -> ${next}`,
    );
  }
}
