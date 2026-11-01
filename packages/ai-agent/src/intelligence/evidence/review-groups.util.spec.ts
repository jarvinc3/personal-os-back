import type { EmailDatasetPartition } from './dataset-partition.util';
import { groupReviewMessages } from './review-groups.util';

const message = (overrides: {
  id: string;
  fromAddress?: string;
  subject?: string;
  templateFingerprint?: string | null;
}) => ({
  id: overrides.id,
  fromAddress: overrides.fromAddress ?? 'alerts@bank.com',
  subject: overrides.subject ?? 'Aviso',
  templateFingerprint:
    overrides.templateFingerprint === undefined
      ? 'template-1'
      : overrides.templateFingerprint,
});

const partitions = (entries: [string, EmailDatasetPartition][]) =>
  new Map<string, EmailDatasetPartition>(entries);

describe('groupReviewMessages', () => {
  it('counts totals, pending and pending HOLDOUT per sender and template', () => {
    const groups = groupReviewMessages({
      messages: [
        message({ id: 'm1' }),
        message({ id: 'm2' }),
        message({ id: 'm3' }),
        message({ id: 'm4' }),
      ],
      partitionByMessageId: partitions([
        ['m1', 'TRAIN'],
        ['m2', 'VALIDATION'],
        ['m3', 'HOLDOUT'],
        ['m4', 'TRAIN'],
      ]),
      reviewedMessageIds: new Set(['m4']),
      sampleSize: 3,
    });

    expect(groups).toEqual([
      {
        fromAddress: 'alerts@bank.com',
        templateFingerprint: 'template-1',
        total: 4,
        pending: 3,
        pendingHoldout: 1,
        sampleSubjects: ['Aviso'],
      },
    ]);
  });

  it('separates groups by sender and template, including a missing template', () => {
    const groups = groupReviewMessages({
      messages: [
        message({ id: 'm1', fromAddress: 'a@bank.com' }),
        message({
          id: 'm2',
          fromAddress: 'a@bank.com',
          templateFingerprint: null,
        }),
        message({ id: 'm3', fromAddress: 'b@bank.com' }),
      ],
      partitionByMessageId: partitions([
        ['m1', 'TRAIN'],
        ['m2', 'TRAIN'],
        ['m3', 'TRAIN'],
      ]),
      reviewedMessageIds: new Set(),
      sampleSize: 3,
    });

    expect(groups).toHaveLength(3);
  });

  it('keeps up to three distinct sample subjects in the given order', () => {
    const groups = groupReviewMessages({
      messages: [
        message({ id: 'm1', subject: 'Primero' }),
        message({ id: 'm2', subject: 'Primero' }),
        message({ id: 'm3', subject: 'Segundo' }),
        message({ id: 'm4', subject: 'Tercero' }),
        message({ id: 'm5', subject: 'Cuarto' }),
      ],
      partitionByMessageId: partitions([
        ['m1', 'TRAIN'],
        ['m2', 'TRAIN'],
        ['m3', 'TRAIN'],
        ['m4', 'TRAIN'],
        ['m5', 'TRAIN'],
      ]),
      reviewedMessageIds: new Set(),
      sampleSize: 3,
    });

    expect(groups[0].sampleSubjects).toEqual(['Primero', 'Segundo', 'Tercero']);
  });

  it('orders by pending, then total, sender and template', () => {
    const groups = groupReviewMessages({
      messages: [
        message({ id: 'm1', fromAddress: 'b@bank.com' }),
        message({ id: 'm2', fromAddress: 'b@bank.com' }),
        message({ id: 'm3', fromAddress: 'a@bank.com' }),
        message({ id: 'm4', fromAddress: 'a@bank.com' }),
        message({ id: 'm5', fromAddress: 'a@bank.com' }),
        message({
          id: 'm6',
          fromAddress: 'c@bank.com',
          templateFingerprint: null,
        }),
        message({ id: 'm7', fromAddress: 'd@bank.com' }),
        message({
          id: 'm8',
          fromAddress: 'c@bank.com',
          templateFingerprint: 'template-2',
        }),
      ],
      partitionByMessageId: partitions([
        ['m1', 'TRAIN'],
        ['m2', 'TRAIN'],
        ['m3', 'TRAIN'],
        ['m4', 'TRAIN'],
        ['m5', 'TRAIN'],
        ['m6', 'TRAIN'],
        ['m7', 'TRAIN'],
        ['m8', 'TRAIN'],
      ]),
      reviewedMessageIds: new Set(['m4', 'm8']),
      sampleSize: 3,
    });

    expect(
      groups.map(({ fromAddress, templateFingerprint, pending, total }) => ({
        fromAddress,
        templateFingerprint,
        pending,
        total,
      })),
    ).toEqual([
      {
        fromAddress: 'a@bank.com',
        templateFingerprint: 'template-1',
        pending: 2,
        total: 3,
      },
      {
        fromAddress: 'b@bank.com',
        templateFingerprint: 'template-1',
        pending: 2,
        total: 2,
      },
      {
        fromAddress: 'c@bank.com',
        templateFingerprint: null,
        pending: 1,
        total: 1,
      },
      {
        fromAddress: 'd@bank.com',
        templateFingerprint: 'template-1',
        pending: 1,
        total: 1,
      },
      {
        fromAddress: 'c@bank.com',
        templateFingerprint: 'template-2',
        pending: 0,
        total: 1,
      },
    ]);
  });

  it('ignores messages without a dataset partition', () => {
    const groups = groupReviewMessages({
      messages: [message({ id: 'm1' }), message({ id: 'm2' })],
      partitionByMessageId: partitions([['m1', 'TRAIN']]),
      reviewedMessageIds: new Set(),
      sampleSize: 3,
    });

    expect(groups[0].total).toBe(1);
  });
});
