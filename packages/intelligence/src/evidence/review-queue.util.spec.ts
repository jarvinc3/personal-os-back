import { BadRequestException } from '@nestjs/common';
import { REVIEW_QUEUE_RESOLVED_PROCESSING_STATUS } from './review-queue.constants';
import {
  assertReviewQueueDateRange,
  encodeReviewQueueCursor,
  latestReviewVerifications,
  reviewQueueItemVerification,
  reviewQueueItems,
  reviewQueueMessageFilter,
  reviewQueueMessageSearchFilter,
  reviewQueuePendingCounts,
  reviewQueueReceivedAtFilter,
  reviewQueueSortDirection,
  toReviewQueueStatusList,
} from './review-queue.util';

describe('review queue utilities', () => {
  describe('toReviewQueueStatusList', () => {
    it('splits a comma list and keeps repeated parameters', () => {
      expect(toReviewQueueStatusList('CONFIRMED,CORRECTED')).toEqual([
        'CONFIRMED',
        'CORRECTED',
      ]);
      expect(toReviewQueueStatusList(['CONFIRMED', 'REJECTED'])).toEqual([
        'CONFIRMED',
        'REJECTED',
      ]);
    });

    it('trims, drops empty entries and removes duplicates', () => {
      expect(toReviewQueueStatusList(' CONFIRMED , CONFIRMED ,, ')).toEqual([
        'CONFIRMED',
      ]);
    });

    it('keeps unknown values so the DTO rejects them', () => {
      expect(toReviewQueueStatusList('CONFIRMED,UNKNOWN')).toEqual([
        'CONFIRMED',
        'UNKNOWN',
      ]);
    });

    it('returns undefined when nothing is selected', () => {
      expect(toReviewQueueStatusList(undefined)).toBeUndefined();
      expect(toReviewQueueStatusList('')).toBeUndefined();
      expect(toReviewQueueStatusList(' , ')).toBeUndefined();
    });
  });

  describe('assertReviewQueueDateRange', () => {
    it('accepts equal or ordered days and an open range', () => {
      expect(() =>
        assertReviewQueueDateRange('2026-10-01', '2026-10-31'),
      ).not.toThrow();
      expect(() =>
        assertReviewQueueDateRange('2026-10-31', '2026-10-31'),
      ).not.toThrow();
      expect(() =>
        assertReviewQueueDateRange(undefined, '2026-10-31'),
      ).not.toThrow();
    });

    it('rejects an inverted range', () => {
      expect(() =>
        assertReviewQueueDateRange('2026-10-31', '2026-10-01'),
      ).toThrow(BadRequestException);
    });
  });

  describe('reviewQueueReceivedAtFilter', () => {
    it('returns undefined without a range', () => {
      expect(
        reviewQueueReceivedAtFilter({
          timezone: 'America/Santo_Domingo',
          dateFrom: undefined,
          dateTo: undefined,
        }),
      ).toBeUndefined();
    });

    it('covers whole local days in the account timezone', () => {
      expect(
        reviewQueueReceivedAtFilter({
          timezone: 'America/Santo_Domingo',
          dateFrom: '2026-10-01',
          dateTo: '2026-10-31',
        }),
      ).toEqual({
        gte: new Date('2026-10-01T04:00:00.000Z'),
        lt: new Date('2026-11-01T04:00:00.000Z'),
      });
    });

    it('falls back to UTC without a profile timezone', () => {
      expect(
        reviewQueueReceivedAtFilter({
          timezone: null,
          dateFrom: '2026-10-01',
          dateTo: '2026-10-01',
        }),
      ).toEqual({
        gte: new Date('2026-10-01T00:00:00.000Z'),
        lt: new Date('2026-10-02T00:00:00.000Z'),
      });
    });

    it('respects a shorter day when daylight saving starts', () => {
      expect(
        reviewQueueReceivedAtFilter({
          timezone: 'Europe/Madrid',
          dateFrom: '2026-03-29',
          dateTo: '2026-03-29',
        }),
      ).toEqual({
        gte: new Date('2026-03-28T23:00:00.000Z'),
        lt: new Date('2026-03-29T22:00:00.000Z'),
      });
    });
  });

  describe('latestReviewVerifications', () => {
    const row = ({
      targetId,
      sequence,
      verdict,
    }: {
      targetId: string | null;
      sequence: bigint;
      verdict: 'CONFIRMED' | 'CORRECTED' | 'REJECTED';
    }) => ({
      targetId,
      sequence,
      verdict,
      correctedPayload: null,
      notes: null,
      createdAt: new Date('2026-10-25T12:00:00.000Z'),
    });

    it('keeps the highest sequence per message and skips untargeted rows', () => {
      const latest = latestReviewVerifications([
        row({ targetId: 'message-1', sequence: 1n, verdict: 'CONFIRMED' }),
        row({ targetId: 'message-1', sequence: 3n, verdict: 'CORRECTED' }),
        row({ targetId: 'message-2', sequence: 2n, verdict: 'REJECTED' }),
        row({ targetId: null, sequence: 4n, verdict: 'CONFIRMED' }),
      ]);

      expect([...latest.keys()]).toEqual(['message-1', 'message-2']);
      expect(latest.get('message-1')?.sequence).toBe(3n);
      expect(latest.get('message-1')?.verdict).toBe('CORRECTED');
    });
  });

  describe('reviewQueueItemVerification', () => {
    const verification = {
      targetId: 'message-1',
      sequence: 2n,
      verdict: 'CORRECTED' as const,
      correctedPayload: {
        relevance: true,
        semanticType: 'TECH_NOTIFICATION',
        routes: [],
      },
      notes: 'Corregido por el dueño',
      createdAt: new Date('2026-10-25T12:00:00.000Z'),
    };

    it('returns the verdict, labels, note and date of the last verification', () => {
      expect(reviewQueueItemVerification(verification)).toEqual({
        verdict: 'CORRECTED',
        labels: {
          relevance: true,
          semanticType: 'TECH_NOTIFICATION',
          routes: [],
        },
        notes: 'Corregido por el dueño',
        createdAt: '2026-10-25T12:00:00.000Z',
      });
    });

    it('reports no labels when the stored payload is not an object', () => {
      expect(
        reviewQueueItemVerification({
          ...verification,
          correctedPayload: null,
        }).labels,
      ).toBeNull();
      expect(
        reviewQueueItemVerification({
          ...verification,
          correctedPayload: ['relevance'],
        }).labels,
      ).toBeNull();
    });
  });

  describe('reviewQueueItems', () => {
    const message = {
      id: 'message-1',
      receivedAt: new Date('2026-10-25T12:00:00.000Z'),
      fromAddress: 'notifications@github.com',
      fromDomain: 'github.com',
      subject: 'Aviso',
      contentFingerprint: 'fingerprint-1',
      processingStatus: 'INGESTED',
    };
    const latest = new Map([
      [
        'message-1',
        {
          targetId: 'message-1',
          sequence: 2n,
          verdict: 'CORRECTED' as const,
          correctedPayload: { semanticType: 'TECH_NOTIFICATION' },
          notes: 'Corregido',
          createdAt: new Date('2026-10-25T12:30:00.000Z'),
        },
      ],
    ]);
    const partitionByMessageId = new Map([
      ['message-1', 'TRAIN' as const],
      ['message-2', 'HOLDOUT' as const],
    ]);

    it('returns the derived status and the last verification', () => {
      expect(
        reviewQueueItems({
          messages: [message],
          partitionByMessageId,
          latestByMessageId: latest,
        }),
      ).toEqual([
        {
          ...message,
          partition: 'TRAIN',
          status: 'CORRECTED',
          verification: {
            verdict: 'CORRECTED',
            labels: { semanticType: 'TECH_NOTIFICATION' },
            notes: 'Corregido',
            createdAt: '2026-10-25T12:30:00.000Z',
          },
        },
      ]);
    });

    it('marks a message without verification as pending', () => {
      expect(
        reviewQueueItems({
          messages: [{ ...message, id: 'message-2' }],
          partitionByMessageId,
          latestByMessageId: latest,
        }),
      ).toEqual([
        {
          ...message,
          id: 'message-2',
          partition: 'HOLDOUT',
          status: 'PENDING',
          verification: null,
        },
      ]);
    });

    it('drops messages outside the dataset', () => {
      expect(
        reviewQueueItems({
          messages: [{ ...message, id: 'message-3' }],
          partitionByMessageId,
          latestByMessageId: latest,
        }),
      ).toEqual([]);
    });
  });

  describe('reviewQueueMessageFilter', () => {
    const reviewed = new Map([
      [
        'message-1',
        {
          targetId: 'message-1',
          sequence: 2n,
          verdict: 'CORRECTED' as const,
          correctedPayload: null,
          notes: null,
          createdAt: new Date('2026-10-25T12:00:00.000Z'),
        },
      ],
      [
        'message-2',
        {
          targetId: 'message-2',
          sequence: 1n,
          verdict: 'REJECTED' as const,
          correctedPayload: null,
          notes: null,
          createdAt: new Date('2026-10-25T12:00:00.000Z'),
        },
      ],
    ]);

    it('keeps only pending messages by default', () => {
      expect(
        reviewQueueMessageFilter({
          userId: 'user-1',
          latestByMessageId: reviewed,
          order: 'OLDEST',
        }),
      ).toEqual({
        userId: 'user-1',
        processingStatus: { not: REVIEW_QUEUE_RESOLVED_PROCESSING_STATUS },
        AND: [{ id: { notIn: ['message-1', 'message-2'] } }],
      });
    });

    it('filters uncertain messages by low confidence or missing predictions', () => {
      expect(
        reviewQueueMessageFilter({
          userId: 'user-1',
          latestByMessageId: new Map(),
          order: 'OLDEST',
          uncertain: true,
        }),
      ).toEqual({
        userId: 'user-1',
        processingStatus: { not: REVIEW_QUEUE_RESOLVED_PROCESSING_STATUS },
        OR: [
          { classifications: { none: {} } },
          { classifications: { some: { confidence: { lt: 0.7 } } } },
        ],
      });
    });

    it('avoids an id clause when every message is pending', () => {
      expect(
        reviewQueueMessageFilter({
          userId: 'user-1',
          latestByMessageId: new Map(),
          order: 'OLDEST',
        }),
      ).toEqual({
        userId: 'user-1',
        processingStatus: { not: REVIEW_QUEUE_RESOLVED_PROCESSING_STATUS },
      });
    });

    it('keeps only messages whose last verification matches the status', () => {
      expect(
        reviewQueueMessageFilter({
          userId: 'user-1',
          latestByMessageId: reviewed,
          statuses: ['CORRECTED'],
          order: 'OLDEST',
        }),
      ).toEqual({
        userId: 'user-1',
        AND: [{ id: { in: ['message-1'] } }],
      });
    });

    it('combines pending with verified statuses', () => {
      expect(
        reviewQueueMessageFilter({
          userId: 'user-1',
          latestByMessageId: reviewed,
          statuses: ['PENDING', 'REJECTED'],
          order: 'OLDEST',
        }),
      ).toEqual({
        userId: 'user-1',
        processingStatus: { not: REVIEW_QUEUE_RESOLVED_PROCESSING_STATUS },
        AND: [
          {
            OR: [
              { id: { notIn: ['message-1', 'message-2'] } },
              { id: { in: ['message-2'] } },
            ],
          },
        ],
      });
    });

    it('adds the sender, subject, date and partition filters', () => {
      expect(
        reviewQueueMessageFilter({
          userId: 'user-1',
          latestByMessageId: new Map(),
          partitionMessageIds: ['message-1'],
          fromAddress: 'notifications@github.com',
          subject: 'Aviso',
          receivedAt: { gte: new Date('2026-10-01T04:00:00.000Z') },
          order: 'OLDEST',
        }),
      ).toEqual({
        userId: 'user-1',
        processingStatus: { not: REVIEW_QUEUE_RESOLVED_PROCESSING_STATUS },
        id: { in: ['message-1'] },
        fromAddress: {
          equals: 'notifications@github.com',
          mode: 'insensitive',
        },
        subject: { contains: 'Aviso', mode: 'insensitive' },
        receivedAt: { gte: new Date('2026-10-01T04:00:00.000Z') },
      });
    });

    it('filters a partition with no items to an empty result', () => {
      expect(
        reviewQueueMessageFilter({
          userId: 'user-1',
          latestByMessageId: new Map(),
          partitionMessageIds: [],
          order: 'OLDEST',
        }),
      ).toEqual({
        userId: 'user-1',
        processingStatus: { not: REVIEW_QUEUE_RESOLVED_PROCESSING_STATUS },
        id: { in: [] },
      });
    });

    it('continues after the cursor in the active direction', () => {
      const cursor = encodeReviewQueueCursor({
        id: 'message-2',
        receivedAt: new Date('2026-10-05T12:00:00.000Z'),
      });

      expect(
        reviewQueueMessageFilter({
          userId: 'user-1',
          latestByMessageId: new Map(),
          cursor,
          order: 'OLDEST',
        }),
      ).toEqual({
        userId: 'user-1',
        processingStatus: { not: REVIEW_QUEUE_RESOLVED_PROCESSING_STATUS },
        AND: [
          {
            OR: [
              { receivedAt: { gt: new Date('2026-10-05T12:00:00.000Z') } },
              {
                receivedAt: new Date('2026-10-05T12:00:00.000Z'),
                id: { gt: 'message-2' },
              },
            ],
          },
        ],
      });
      expect(
        reviewQueueMessageFilter({
          userId: 'user-1',
          latestByMessageId: new Map(),
          cursor,
          order: 'NEWEST',
        }),
      ).toEqual({
        userId: 'user-1',
        processingStatus: { not: REVIEW_QUEUE_RESOLVED_PROCESSING_STATUS },
        AND: [
          {
            OR: [
              { receivedAt: { lt: new Date('2026-10-05T12:00:00.000Z') } },
              {
                receivedAt: new Date('2026-10-05T12:00:00.000Z'),
                id: { lt: 'message-2' },
              },
            ],
          },
        ],
      });
    });

    it('rejects a malformed or forged cursor', () => {
      expect(() =>
        reviewQueueMessageFilter({
          userId: 'user-1',
          latestByMessageId: new Map(),
          cursor: 'not-a-cursor',
          order: 'OLDEST',
        }),
      ).toThrow(BadRequestException);
      const forged = Buffer.from(
        JSON.stringify({ key: 'not-a-date', id: 'message-1' }),
      ).toString('base64url');
      expect(() =>
        reviewQueueMessageFilter({
          userId: 'user-1',
          latestByMessageId: new Map(),
          cursor: forged,
          order: 'OLDEST',
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('reviewQueueSortDirection', () => {
    it('maps the order to the received date direction', () => {
      expect(reviewQueueSortDirection('OLDEST')).toBe('asc');
      expect(reviewQueueSortDirection('NEWEST')).toBe('desc');
    });
  });

  describe('reviewQueueMessageSearchFilter', () => {
    it('builds the sender, subject and date clauses', () => {
      const receivedAt = {
        gte: new Date('2026-10-01T04:00:00.000Z'),
        lt: new Date('2026-11-01T04:00:00.000Z'),
      };

      expect(
        reviewQueueMessageSearchFilter({
          fromAddress: 'notifications@github.com',
          subject: 'Aviso',
          receivedAt,
        }),
      ).toEqual({
        fromAddress: {
          equals: 'notifications@github.com',
          mode: 'insensitive',
        },
        subject: { contains: 'Aviso', mode: 'insensitive' },
        receivedAt,
      });
      expect(reviewQueueMessageSearchFilter({})).toEqual({});
    });
  });

  describe('reviewQueuePendingCounts', () => {
    const items = [
      { sourceId: 'message-1', partition: 'TRAIN' as const },
      { sourceId: 'message-2', partition: 'VALIDATION' as const },
      { sourceId: 'message-3', partition: 'HOLDOUT' as const },
      { sourceId: 'message-4', partition: 'HOLDOUT' as const },
    ];

    it('counts pending items and applies the search match', () => {
      expect(
        reviewQueuePendingCounts({
          items,
          reviewedMessageIds: ['message-2'],
          matchingMessageIds: new Set(['message-1', 'message-2', 'message-3']),
        }),
      ).toEqual({ TRAIN: 1, VALIDATION: 0, HOLDOUT: 1, all: 2 });
    });

    it('counts every pending item without a search', () => {
      expect(
        reviewQueuePendingCounts({ items, reviewedMessageIds: [] }),
      ).toEqual({ TRAIN: 1, VALIDATION: 1, HOLDOUT: 2, all: 4 });
    });

    it('returns zeroes when no item passes the search', () => {
      expect(
        reviewQueuePendingCounts({
          items,
          reviewedMessageIds: [],
          matchingMessageIds: new Set(),
        }),
      ).toEqual({ TRAIN: 0, VALIDATION: 0, HOLDOUT: 0, all: 0 });
    });

    it('excludes messages that no longer require review', () => {
      expect(
        reviewQueuePendingCounts({
          items,
          reviewedMessageIds: [],
          resolvedMessageIds: new Set(['message-1', 'message-3']),
        }),
      ).toEqual({ TRAIN: 0, VALIDATION: 1, HOLDOUT: 1, all: 2 });
    });
  });
});
