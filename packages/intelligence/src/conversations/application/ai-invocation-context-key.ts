import { createHash } from 'node:crypto';
import type { AiInvocationContext } from '@personal-os/core';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

/** Stable owner-independent equivalence key; ownership is always checked separately. */
export function aiInvocationContextKey(context: AiInvocationContext): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(context)))
    .digest('hex');
}
