import { isReceivableShareReachable } from './receivable-share';

const now = new Date('2026-10-16T12:00:00.000Z');

function share(overrides: Record<string, unknown> = {}) {
  return {
    isActive: true,
    revokedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

describe('isReceivableShareReachable', () => {
  it('reaches an active share without expiry', () => {
    expect(isReceivableShareReachable(share(), now)).toBe(true);
  });

  it('hides an inactive share', () => {
    expect(isReceivableShareReachable(share({ isActive: false }), now)).toBe(
      false,
    );
  });

  it('hides a revoked share even if it still says active', () => {
    expect(isReceivableShareReachable(share({ revokedAt: now }), now)).toBe(
      false,
    );
  });

  it('hides an expired share', () => {
    expect(
      isReceivableShareReachable(
        share({ expiresAt: new Date('2026-10-15T00:00:00.000Z') }),
        now,
      ),
    ).toBe(false);
  });
});
