import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createSettingsDescriptor } from '@personal-os/contracts';
import { AppEvents } from '@personal-os/core';
import type { PrismaService } from '@personal-os/database';
import { FinanceEvents } from '@personal-os/finance';
import { ModuleSettingsRegistry } from '../module-settings/module-settings.registry';
import { ModuleSettingsService } from '../module-settings/module-settings.service';

const repositoryRoot = resolve(__dirname, '../../../..');

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return filesUnder(path);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function projectFiles(relativeDirectory: string): string[] {
  return filesUnder(join(repositoryRoot, relativeDirectory));
}

function runtimeFiles(relativeDirectory: string): string[] {
  return projectFiles(relativeDirectory).filter(
    (file) => !file.endsWith('.spec.ts'),
  );
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/** Jest 30 has no message argument; this keeps the offending file in the error. */
function expectNoMatch(source: string, pattern: RegExp, file: string): void {
  const match = pattern.exec(source);
  if (match) {
    throw new Error(`${file} matches ${pattern}: ${match[0]}`);
  }
}

function packageDependencies(relativePath: string): string[] {
  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, relativePath), 'utf8'),
  ) as { dependencies?: Record<string, string> };
  return Object.keys(manifest.dependencies ?? {});
}

describe('Roadmap frontier invariants', () => {
  it('1. the generic AI runtime does not import Finance implementation or its facade', () => {
    const aiRuntimeFiles = [
      ...projectFiles('packages/intelligence/src'),
      ...projectFiles('packages/core/src/ai'),
    ];

    for (const file of aiRuntimeFiles) {
      const source = read(file);
      expectNoMatch(
        source,
        /from\s+['"][^'"]*(?:@personal-os\/finance|packages\/finance)[^'"]*['"]/,
        file,
      );
      expectNoMatch(
        source,
        /\b(?:FinanceFacade|FinanceModule|FinanceService)\b/,
        file,
      );
    }
  });

  it('2. Finance does not import Gmail provider or source infrastructure', () => {
    for (const file of runtimeFiles('packages/finance/src')) {
      const source = read(file);
      expectNoMatch(
        source,
        /from\s+['"][^'"]*(?:googleapis|@google\/|gmail-(?:source|sync))[^'"]*['"]/i,
        file,
      );
      expectNoMatch(source, /\bGmail\b|\bOAuth\b/, file);
    }
    expect(
      runtimeFiles('packages/finance/src').some((file) =>
        file.includes('ingestion'),
      ),
    ).toBe(false);
    expect(
      packageDependencies('packages/finance/package.json').join(' '),
    ).not.toMatch(/google|gmail|oauth/i);
  });

  it('3. Finance does not import chat context contracts', () => {
    for (const file of runtimeFiles('packages/finance/src')) {
      const source = read(file);
      expectNoMatch(source, /from\s+['"][^'"]*chat-context[^'"]*['"]/, file);
      expectNoMatch(
        source,
        /\b(?:ChatContext|ChatContextEntity|EntityRef|EntityRefType|ENTITY_REF_TYPES)\b/,
        file,
      );
    }
  });

  it('4. Notifications does not import Finance payloads, copy or settings constants', () => {
    for (const file of projectFiles('packages/notifications/src')) {
      const source = read(file);
      expectNoMatch(
        source,
        /from\s+['"][^'"]*(?:@personal-os\/finance|packages\/finance)[^'"]*['"]/,
        file,
      );
      expectNoMatch(
        source,
        /\b(?:FinanceEvents|FinanceDomainEvent|FinanceNotificationIntents|FINANCE_NOTIFICATION_KEYS|FinanceModule|FinanceFacade)\b/,
        file,
      );
    }
    expect(
      packageDependencies('packages/notifications/package.json'),
    ).not.toContain('@personal-os/finance');
  });

  it('5. Core does not contain Finance event constants or DTOs', () => {
    for (const file of runtimeFiles('packages/core/src')) {
      const source = read(file);
      expectNoMatch(source, /finance\.|FINANCE_[A-Z_]+/, file);
      expectNoMatch(
        source,
        /TransactionCreatedEvent|TransactionUpdatedEvent|BudgetThresholdReachedEvent|FinanceTransferCreatedEvent/,
        file,
      );
    }
  });

  it('6. Users does not import Finance configuration validators or defaults', () => {
    for (const file of projectFiles('packages/users/src')) {
      expectNoMatch(
        read(file),
        /from\s+['"][^'"]*(?:@personal-os\/finance|packages\/finance)[^'"]*['"]/,
        file,
      );
    }

    for (const file of runtimeFiles('packages/users/src')) {
      expectNoMatch(
        read(file),
        /\b(?:FINANCE_NOTIFICATION_KEYS|DEFAULT_MODULE_CONFIG_BY_SLUG|validateCardDueDaysBefore|validateSubscriptionReminderDays|resolveCardDueDaysBefore|resolveSubscriptionReminderDays|FINANCE_SETTINGS_DEFAULTS)\b/,
        file,
      );
    }
    expect(packageDependencies('packages/users/package.json')).not.toContain(
      '@personal-os/finance',
    );
  });

  it('7. a new module registers settings without touching central Users defaults', async () => {
    const descriptor = createSettingsDescriptor({
      slug: 'demo-settings',
      version: 1,
      defaults: { version: 1, notifications: { digest: true } },
    });
    const registry = new ModuleSettingsRegistry([descriptor]);
    const prisma = {
      userModule: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const reader = new ModuleSettingsService(prisma, registry);

    await expect(reader.read('user-1', 'demo-settings')).resolves.toEqual({
      enabled: false,
      version: 1,
      config: { version: 1, notifications: { digest: true } },
    });
    await expect(
      reader.notificationEnabled('user-1', 'demo-settings', 'digest'),
    ).resolves.toBe(true);
    expect(registry.list().map((registered) => registered.slug)).toContain(
      'demo-settings',
    );

    for (const file of projectFiles('packages/users/src')) {
      expectNoMatch(read(file), /DEFAULT_MODULE_CONFIG_BY_SLUG/, file);
    }
  });

  it('8. a new domain event does not require touching Core event constants', () => {
    const platformPrefixes = /^(?:user|notification|ai|module)\./;
    const platformEvents = Object.values(AppEvents) as string[];

    for (const eventName of platformEvents) {
      expect(eventName).toMatch(platformPrefixes);
    }
    for (const domainEventName of Object.values(FinanceEvents) as string[]) {
      expect(platformEvents).not.toContain(domainEventName);
    }

    expectNoMatch(
      read(join(repositoryRoot, 'packages/core/src/events/event.constants.ts')),
      /\b(?:FinanceEvents|AgendaEvents|ProjectsEvents|HealthEvents)\b/,
      'packages/core/src/events/event.constants.ts',
    );
  });
});
