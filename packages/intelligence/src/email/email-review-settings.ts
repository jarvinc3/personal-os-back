import type { ModuleSettingsReader } from '@personal-os/contracts';
import { EMAIL_REVIEW_CONFIDENCE_THRESHOLD } from './email-classification-persistence';

export type EmailReviewSettings = {
  reviewConfidenceThreshold: number;
  acceptVerifiedSenders: boolean;
};

export async function loadEmailReviewSettings(
  reader: ModuleSettingsReader | undefined,
  userId: string,
): Promise<EmailReviewSettings> {
  if (!reader) {
    return defaultEmailReviewSettings();
  }
  const settings = await reader.read(userId, 'ai');
  const config = isRecord(settings.config) ? settings.config : {};
  const email = isRecord(config.email) ? config.email : {};
  return {
    reviewConfidenceThreshold:
      typeof email.reviewConfidenceThreshold === 'number' &&
      Number.isFinite(email.reviewConfidenceThreshold)
        ? email.reviewConfidenceThreshold
        : EMAIL_REVIEW_CONFIDENCE_THRESHOLD,
    acceptVerifiedSenders: email.acceptVerifiedSenders === true,
  };
}

export function defaultEmailReviewSettings(): EmailReviewSettings {
  return {
    reviewConfidenceThreshold: EMAIL_REVIEW_CONFIDENCE_THRESHOLD,
    acceptVerifiedSenders: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
