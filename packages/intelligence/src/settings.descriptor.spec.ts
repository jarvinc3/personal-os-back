import { BadRequestException } from '@nestjs/common';
import { INTELLIGENCE_SETTINGS_DESCRIPTOR } from './settings.descriptor';

describe('Intelligence settings descriptor', () => {
  it('defaults email review settings to a 0.7 confidence threshold', () => {
    expect(INTELLIGENCE_SETTINGS_DESCRIPTOR.normalize({})).toMatchObject({
      email: {
        reviewConfidenceThreshold: 0.7,
        acceptVerifiedSenders: false,
      },
    });
  });

  it('accepts a bounded threshold and merges partial settings', () => {
    expect(
      INTELLIGENCE_SETTINGS_DESCRIPTOR.normalize({
        email: { reviewConfidenceThreshold: 0.8 },
      }),
    ).toMatchObject({
      email: {
        reviewConfidenceThreshold: 0.8,
        acceptVerifiedSenders: false,
      },
    });
  });

  it.each([-0.01, 1.01, '0.8', null])(
    'rejects an invalid confidence threshold: %p',
    (threshold) => {
      expect(() =>
        INTELLIGENCE_SETTINGS_DESCRIPTOR.normalize({
          email: { reviewConfidenceThreshold: threshold },
        }),
      ).toThrow(BadRequestException);
    },
  );

  it('rejects a non-boolean verified-sender setting', () => {
    expect(() =>
      INTELLIGENCE_SETTINGS_DESCRIPTOR.normalize({
        email: { acceptVerifiedSenders: 'true' },
      }),
    ).toThrow(BadRequestException);
  });
});
