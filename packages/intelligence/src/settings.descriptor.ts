import { BadRequestException } from '@nestjs/common';
import {
  createSettingsDescriptor,
  type JsonObject,
} from '@personal-os/contracts';
import { DEFAULT_MODULE_CONFIG_BY_SLUG } from '@personal-os/users';

const defaults = DEFAULT_MODULE_CONFIG_BY_SLUG.ai as unknown as JsonObject;

type AiModuleConfig = JsonObject & {
  version: number;
  fieldGuide: string;
  email: {
    reviewConfidenceThreshold: number;
    acceptVerifiedSenders: boolean;
  };
};

export const INTELLIGENCE_SETTINGS_DESCRIPTOR =
  createSettingsDescriptor<AiModuleConfig>({
    slug: 'ai',
    version: 1,
    defaults: defaults as AiModuleConfig,
    validate(config) {
      const email = config.email;
      if (!email || typeof email !== 'object' || Array.isArray(email)) {
        throw new BadRequestException('email settings must be an object');
      }
      const threshold = email.reviewConfidenceThreshold;
      if (
        typeof threshold !== 'number' ||
        !Number.isFinite(threshold) ||
        threshold < 0 ||
        threshold > 1
      ) {
        throw new BadRequestException(
          'email.reviewConfidenceThreshold must be a number between 0 and 1',
        );
      }
      if (typeof email.acceptVerifiedSenders !== 'boolean') {
        throw new BadRequestException(
          'email.acceptVerifiedSenders must be a boolean',
        );
      }
    },
  });
