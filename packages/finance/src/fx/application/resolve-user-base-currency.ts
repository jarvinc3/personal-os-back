import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import {
  DEFAULT_MODULE_CONFIG_BY_SLUG,
  mergeWithDefaults,
  USERS_REPOSITORY,
  type UsersRepositoryPort,
} from '@personal-os/users';
import {
  isIsoCurrency,
  normalizeCurrencyCode,
} from '../../shared/domain/money';

const FINANCE_MODULE_SLUG = 'finance';

/**
 * User's base currency: the finance module config when it holds a valid ISO
 * code, env `BASE_CURRENCY` otherwise. Resolve once per request and pass it
 * down, so the ledger never reads env per row.
 */
@Injectable()
export class ResolveUserBaseCurrencyUseCase {
  constructor(
    @Inject(USERS_REPOSITORY)
    private readonly users: UsersRepositoryPort,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async execute(userId: string): Promise<string> {
    const row = await this.users.findUserModuleBySlug(
      userId,
      FINANCE_MODULE_SLUG,
    );
    const mergedConfig = mergeWithDefaults(
      row?.config,
      DEFAULT_MODULE_CONFIG_BY_SLUG.finance as unknown as Record<
        string,
        unknown
      >,
    );
    const baseCurrency =
      typeof mergedConfig.baseCurrency === 'string'
        ? normalizeCurrencyCode(mergedConfig.baseCurrency)
        : '';
    if (isIsoCurrency(baseCurrency)) {
      return baseCurrency;
    }
    return this.config.get('BASE_CURRENCY', { infer: true });
  }
}
