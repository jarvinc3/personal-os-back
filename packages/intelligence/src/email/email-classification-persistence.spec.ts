import { requiresReview } from './email-classification-persistence';
import type { EmailClassification } from './email-classification.util';

const classification = (confidence: number) =>
  ({ confidence }) as EmailClassification;

describe('classification review threshold', () => {
  it('uses the configured threshold for non-HOLDOUT messages', () => {
    expect(
      requiresReview({
        classification: classification(0.75),
        auditSample: false,
        reviewConfidenceThreshold: 0.8,
      }),
    ).toBe(true);
  });

  it('keeps the fixed default threshold for HOLDOUT messages', () => {
    expect(
      requiresReview({
        classification: classification(0.75),
        auditSample: false,
        reviewConfidenceThreshold: 0.8,
        isHoldout: true,
      }),
    ).toBe(false);
  });

  it('can auto-accept a verified sender but never bypass an audit sample', () => {
    expect(
      requiresReview({
        classification: classification(0.3),
        auditSample: false,
        reviewConfidenceThreshold: 0.8,
        verifiedSender: true,
        acceptVerifiedSenders: true,
      }),
    ).toBe(false);
    expect(
      requiresReview({
        classification: classification(0.3),
        auditSample: true,
        reviewConfidenceThreshold: 0.8,
        verifiedSender: true,
        acceptVerifiedSenders: true,
      }),
    ).toBe(true);
  });
});
