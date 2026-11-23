import type { UsersRepositoryPort } from '@personal-os/users';
import { resolveSubscriptionReminderDays } from '../../settings/finance-settings';

const FINANCE_MODULE_SLUG = 'finance';

/** Global warning window of the finance module, in days. */
export class SubscriptionReminderWindow {
  constructor(private readonly usersRepository: UsersRepositoryPort) {}

  async resolve(userId: string): Promise<number> {
    const row = await this.usersRepository.findUserModuleBySlug(
      userId,
      FINANCE_MODULE_SLUG,
    );
    return resolveSubscriptionReminderDays(row?.config);
  }
}
