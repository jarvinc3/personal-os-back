import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { AppEvents } from '@personal-os/core';
import {
  DATA_APP,
  expandDataBranches,
  groupDataBranchCounts,
  isKnownDataBranch,
  type DataAppBranches,
  type DataBranchDescriptor,
} from '../domain/data-branches';
import {
  SETTINGS_DATA_BRANCHES,
  SETTINGS_DEFAULTS_BRANCH,
} from '../domain/settings-data-branches';
import {
  USERS_REPOSITORY,
  type UsersRepositoryPort,
} from './ports/users.repository.port';
import {
  USER_DATA_WIPE_DOMAINS,
  type UserDataWipeDomainsPort,
} from './ports/user-data-wipe-domains.port';

export type WipeUserDataResult = {
  success: true;
  requestedBranches: string[];
  appliedBranches: string[];
  counts: Record<string, number>;
};

export type WipeUserDataOptions = {
  expectedCounts?: Record<string, number>;
  balanceInstitutionId?: string;
};

const FINANCE_BALANCES_BRANCH = 'finance.balances';

/**
 * Consults the branch registry each app declares, expands what the requested
 * branches drag, checks the counts the user saw and then lets every app apply
 * its own part in one transaction. One aggregated event at the end.
 */
@Injectable()
export class WipeUserDataUseCase {
  private readonly logger = new Logger(WipeUserDataUseCase.name);

  constructor(
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepositoryPort,
    @Inject(USER_DATA_WIPE_DOMAINS)
    private readonly domains: UserDataWipeDomainsPort,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Every branch of every app, with what the user would delete today. */
  async listBranches(userId: string): Promise<DataAppBranches[]> {
    const user = await this.requireUser(userId);
    const descriptors = this.descriptorsFor(user);
    const counts = await this.countBranches(userId, descriptors, user);
    return groupDataBranchCounts(descriptors, counts);
  }

  async execute(
    userId: string,
    requestedBranches: string[],
    options: WipeUserDataOptions = {},
  ): Promise<WipeUserDataResult> {
    const user = await this.requireUser(userId);
    const descriptors = this.descriptorsFor(user);
    this.assertKnownBranches(descriptors, requestedBranches);

    const applied = expandDataBranches(descriptors, requestedBranches);
    const currentCounts = await this.countBranches(userId, applied, user);
    this.assertExpectedCounts(requestedBranches, currentCounts, options);

    const counts = await this.applyBranches(userId, applied, options);
    const appliedIds = applied.map((branch) => branch.id);

    this.eventEmitter.emit(AppEvents.USER_DATA_WIPED, {
      eventId: randomUUID(),
      userId,
      requestedBranches,
      appliedBranches: appliedIds,
      counts,
    });
    this.logger.log(
      `user_data_wiped userId=${userId} requested=${requestedBranches.join(',')} applied=${appliedIds.join(',')}`,
    );

    return {
      success: true,
      requestedBranches,
      appliedBranches: appliedIds,
      counts,
    };
  }

  private descriptors(): DataBranchDescriptor[] {
    return [...this.domains.dataBranches(), ...SETTINGS_DATA_BRANCHES];
  }

  /** A branch of an app the user does not have enabled is not offered. */
  private descriptorsFor(user: {
    userModules: Array<{ isEnabled: boolean; module: { slug: string } }>;
  }): DataBranchDescriptor[] {
    const enabled = new Set(
      user.userModules
        .filter((userModule) => userModule.isEnabled)
        .map((userModule) => userModule.module.slug),
    );
    return this.descriptors().filter(
      (branch) => branch.app !== DATA_APP.FINANCE || enabled.has('finance'),
    );
  }

  private async requireUser(userId: string) {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return user;
  }

  private assertKnownBranches(
    descriptors: readonly DataBranchDescriptor[],
    requested: readonly string[],
  ): void {
    const unknown = requested.filter(
      (id) => !isKnownDataBranch(descriptors, id),
    );
    if (unknown.length > 0) {
      throw new BadRequestException({
        message: 'Rama de datos desconocida',
        branches: unknown,
      });
    }
  }

  /** Counts come from the same definition each app uses to delete. */
  private async countBranches(
    userId: string,
    branches: readonly DataBranchDescriptor[],
    user: { preferences: unknown },
  ): Promise<Record<string, number>> {
    const ids = branches.map((branch) => branch.id);
    const foreignIds = ids.filter((id) => id !== SETTINGS_DEFAULTS_BRANCH);
    const counts = foreignIds.length
      ? await this.domains.countDataBranches(userId, foreignIds)
      : {};
    if (ids.includes(SETTINGS_DEFAULTS_BRANCH)) {
      counts[SETTINGS_DEFAULTS_BRANCH] = this.settingsCount(user.preferences);
    }
    return counts;
  }

  private settingsCount(preferences: unknown): number {
    if (
      typeof preferences !== 'object' ||
      preferences === null ||
      Array.isArray(preferences)
    ) {
      return 0;
    }
    return Object.keys(preferences).length > 0 ? 1 : 0;
  }

  /** Nothing is deleted when the counts the user saw no longer hold. */
  private assertExpectedCounts(
    requested: readonly string[],
    currentCounts: Readonly<Record<string, number>>,
    options: WipeUserDataOptions,
  ): void {
    const expected = options.expectedCounts;
    if (!expected) {
      return;
    }
    const mismatched = requested.filter(
      (id) => expected[id] !== undefined && expected[id] !== currentCounts[id],
    );
    if (mismatched.length === 0) {
      return;
    }
    throw new ConflictException({
      message: 'Los conteos cambiaron; vuelve a revisar antes de vaciar',
      counts: Object.fromEntries(
        requested
          .filter((id) => expected[id] !== undefined)
          .map((id) => [id, currentCounts[id] ?? 0]),
      ),
    });
  }

  private async applyBranches(
    userId: string,
    applied: readonly DataBranchDescriptor[],
    options: WipeUserDataOptions,
  ): Promise<Record<string, number>> {
    const ids = applied.map((branch) => branch.id);
    const settingsRequested = ids.includes(SETTINGS_DEFAULTS_BRANCH);
    const foreignIds = ids.filter((id) => id !== SETTINGS_DEFAULTS_BRANCH);
    const balanceInstitutionId = ids.includes(FINANCE_BALANCES_BRANCH)
      ? options.balanceInstitutionId
      : undefined;

    const counts = foreignIds.length
      ? await this.domains.wipeDataBranches(
          userId,
          foreignIds,
          balanceInstitutionId ? { balanceInstitutionId } : undefined,
        )
      : {};
    if (settingsRequested) {
      await this.usersRepository.resetSettingsToDefaults(userId);
    }
    return counts;
  }
}
