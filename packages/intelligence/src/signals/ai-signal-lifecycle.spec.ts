import { ConflictException } from '@nestjs/common';
import { assertAiSignalTransition } from './ai-signal-lifecycle';

describe('AI signal lifecycle', () => {
  it('allows routing after validation and consumption after routing', () => {
    expect(() => assertAiSignalTransition('VALIDATED', 'ROUTED')).not.toThrow();
    expect(() => assertAiSignalTransition('ROUTED', 'CONSUMED')).not.toThrow();
  });

  it('rejects transitions out of terminal states and invalid shortcuts', () => {
    expect(() => assertAiSignalTransition('DETECTED', 'CONSUMED')).toThrow(
      ConflictException,
    );
    expect(() => assertAiSignalTransition('CONSUMED', 'ROUTED')).toThrow(
      ConflictException,
    );
  });
});
