const RECONNECT_REQUIRED_CODES = new Set([
  'invalid_grant',
  'gmail_refresh_token_missing',
]);

export function requiresGmailReconnect(errorCode: string): boolean {
  return RECONNECT_REQUIRED_CODES.has(errorCode.toLowerCase());
}
