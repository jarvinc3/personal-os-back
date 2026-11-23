import { HttpException } from '@nestjs/common';
import type { GmailSyncProgress } from './gmail-sync.types';

export function classifyError(
  code: string,
): GmailSyncProgress['errorCategory'] {
  const normalized = code.toLowerCase();
  if (
    /invalid_grant|token_refresh|refresh_token|unauthorized|unauthenticated|autherror|http_401|http_403|forbidden|insufficientpermissions|permission_denied|access_denied/.test(
      normalized,
    )
  ) {
    return 'authorization';
  }
  if (
    /not_configured|missing_configuration|redirect_uri_mismatch|invalid_client/.test(
      normalized,
    )
  ) {
    return 'configuration';
  }
  if (
    /ratelimit|quota|userratelimit|http_429|resource_exhausted/.test(normalized)
  ) {
    return 'rate_limit';
  }
  if (
    /timeout|network|fetch|http_5\d\d|unavailable|internalerror|backenderror/.test(
      normalized,
    )
  ) {
    return 'temporary';
  }
  return 'unknown';
}

export function safeErrorCode(error: unknown): string {
  const code =
    providerErrorCode(error) ??
    exceptionErrorCode(error) ??
    (error instanceof Error ? error.message : 'gmail_sync_failed');
  return code.slice(0, 120).replace(/[^a-zA-Z0-9_.:-]/g, '_');
}

export function exceptionErrorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) {
    return undefined;
  }
  const response = error.getResponse();
  if (typeof response === 'string') {
    return response;
  }
  if (typeof response !== 'object' || response === null) {
    return undefined;
  }
  const code = (response as Record<string, unknown>).code;
  return typeof code === 'string' ? code : undefined;
}

export function isGmailNotFound(error: unknown): boolean {
  const providerCode = providerErrorCode(error);
  return (
    providerCode === 'NOT_FOUND' ||
    providerCode === 'notFound' ||
    providerCode === 'http_404'
  );
}

export function providerErrorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) {
    return undefined;
  }
  const response = error.getResponse();
  if (typeof response !== 'object' || response === null) {
    return undefined;
  }
  const providerCode = (response as Record<string, unknown>).providerCode;
  return typeof providerCode === 'string' ? providerCode : undefined;
}
