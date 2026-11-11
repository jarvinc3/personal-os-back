import {
  sortReviewGroupsByImpact,
  sortReviewQueueByImpact,
  reviewGroupImpactKey,
} from './review-impact.util';

describe('review impact ordering', () => {
  it('prioritizes group size, unknown senders, then lower confidence', () => {
    const groups = [
      {
        fromAddress: 'known@bank.com',
        templateFingerprint: 'large',
        pending: 8,
        total: 8,
      },
      {
        fromAddress: 'new@bank.com',
        templateFingerprint: 'same',
        pending: 4,
        total: 4,
      },
      {
        fromAddress: 'known@bank.com',
        templateFingerprint: 'same',
        pending: 4,
        total: 4,
      },
      {
        fromAddress: 'known@bank.com',
        templateFingerprint: 'low',
        pending: 4,
        total: 4,
      },
    ];

    expect(
      sortReviewGroupsByImpact(groups, {
        knownSenders: new Set(['known@bank.com']),
        confidenceByGroup: new Map([
          [reviewGroupImpactKey('known@bank.com', 'same'), 0.6],
          [reviewGroupImpactKey('known@bank.com', 'low'), 0.2],
          [reviewGroupImpactKey('new@bank.com', 'same'), 0.9],
        ]),
      }).map(({ fromAddress, templateFingerprint }) => [
        fromAddress,
        templateFingerprint,
      ]),
    ).toEqual([
      ['known@bank.com', 'large'],
      ['new@bank.com', 'same'],
      ['known@bank.com', 'low'],
      ['known@bank.com', 'same'],
    ]);
  });

  it('orders queue items by their group impact and supports an impact cursor id', () => {
    const items = [
      {
        id: 'low-confidence',
        pendingInGroup: 2,
        senderKnown: false,
        confidence: 0.2,
        receivedAt: new Date('2026-10-03T00:00:00.000Z'),
      },
      {
        id: 'large-group',
        pendingInGroup: 5,
        senderKnown: true,
        confidence: 0.8,
        receivedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
      {
        id: 'unknown-sender',
        pendingInGroup: 2,
        senderKnown: false,
        confidence: 0.7,
        receivedAt: new Date('2026-10-02T00:00:00.000Z'),
      },
      {
        id: 'known-sender',
        pendingInGroup: 2,
        senderKnown: true,
        confidence: 0.1,
        receivedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    ];

    expect(sortReviewQueueByImpact(items).map(({ id }) => id)).toEqual([
      'large-group',
      'low-confidence',
      'unknown-sender',
      'known-sender',
    ]);
  });
});
