import { createHash } from 'node:crypto';

export type AiInvocationContextKeyInput = {
  route: string;
  view?: string;
  sheet?: string;
  entityRef?: { type: string; id: string };
  filters?: Record<string, unknown>;
};

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
export function aiInvocationContextKey(
  context: AiInvocationContextKeyInput,
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(context)))
    .digest('hex');
}
