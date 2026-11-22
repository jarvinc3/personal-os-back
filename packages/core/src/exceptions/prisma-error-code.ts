/**
 * Prisma error codes the API translates instead of answering a bare 500.
 * Named once: the exception filter and the idempotency interceptor both read
 * them from here.
 */
export const PRISMA_ERROR_CODE = {
  UNIQUE_VIOLATION: 'P2002',
  RECORD_NOT_FOUND: 'P2025',
} as const;
