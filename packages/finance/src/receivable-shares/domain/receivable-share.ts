/** Error codes shared by the authenticated and public share endpoints. */
export const RECEIVABLE_SHARE_ERROR = {
  /** The chosen receivables do not exist or belong to another user. */
  RECEIVABLE_NOT_FOUND: 'RECEIVABLE_SHARE_RECEIVABLE_NOT_FOUND',
  /** Missing, revoked, expired or inactive: one generic answer for all. */
  NOT_FOUND: 'RECEIVABLE_SHARE_NOT_FOUND',
} as const;

type ShareReachability = {
  isActive: boolean;
  revokedAt: Date | null;
  expiresAt: Date | null;
};

/** A share still resolves only while active, not revoked and not expired. */
export function isReceivableShareReachable(
  share: ShareReachability,
  now: Date,
): boolean {
  if (!share.isActive || share.revokedAt) {
    return false;
  }
  if (share.expiresAt && share.expiresAt <= now) {
    return false;
  }
  return true;
}
