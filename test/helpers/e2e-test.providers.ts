import type { TestingModuleBuilder } from '@nestjs/testing';
import { applyAuthTestOverrides } from './auth-test.providers';
import { applyExternalTestOverrides } from './external-test.providers';

export function applyE2eTestOverrides(
  builder: TestingModuleBuilder,
): TestingModuleBuilder {
  return applyExternalTestOverrides(applyAuthTestOverrides(builder));
}
