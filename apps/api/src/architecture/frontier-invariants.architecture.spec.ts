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

type NoMatchInput = {
  source: string;
  pattern: RegExp;
  file: string;
};

/** Jest 30 has no message argument; this keeps the offending file in the error. */
function expectNoMatch({ source, pattern, file }: NoMatchInput): void {
  const match = pattern.exec(source);
  if (match) {
    throw new Error(`${file} matches ${pattern}: ${match[0]}`);
  }
}

type ModuleReferenceInput = {
  source: string;
  modules: readonly string[];
  file: string;
  flags?: string;
};

/** Detects static (including side-effect), dynamic and CommonJS references. */
function expectNoModuleReference({
  source,
  modules,
  file,
  flags = '',
}: ModuleReferenceInput): void {
  const names = modules.join('|');
  const quotedModule = `['"\`][^'"\`]*(?:${names})[^'"\`]*['"\`]`;
  expectNoMatch({
    source,
    pattern: new RegExp(
      `(?:from\\s+|import\\s*\\(\\s*|import\\s+|require\\s*\\(\\s*)${quotedModule}`,
      flags,
    ),
    file,
  });
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
      ...runtimeFiles('packages/intelligence/src'),
      ...runtimeFiles('packages/core/src/ai'),
    ];

    for (const file of aiRuntimeFiles) {
      const source = read(file);
      expectNoModuleReference({
        source,
        modules: ['@personal-os/finance', 'packages/finance'],
        file,
      });
      expectNoMatch({
        source,
        pattern: /\b(?:FinanceFacade|FinanceModule|FinanceService)\b/,
        file,
      });
    }
  });

  it('2. Finance does not import Gmail provider or source infrastructure', () => {
    for (const file of runtimeFiles('packages/finance/src')) {
      const source = read(file);
      expectNoModuleReference({
        source,
        modules: ['googleapis', '@google/', 'gmail-source', 'gmail-sync'],
        file,
        flags: 'i',
      });
      expectNoMatch({ source, pattern: /\bGmail\b|\bOAuth\b/, file });
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
      expectNoModuleReference({ source, modules: ['chat-context'], file });
      expectNoMatch({
        source,
        pattern:
          /\b(?:ChatContext|ChatContextEntity|EntityRef|EntityRefType|ENTITY_REF_TYPES)\b/,
        file,
      });
    }
  });

  it('4. Notifications does not import Finance payloads, copy or settings constants', () => {
    for (const file of projectFiles('packages/notifications/src')) {
      const source = read(file);
      expectNoModuleReference({
        source,
        modules: ['@personal-os/finance', 'packages/finance'],
        file,
      });
      expectNoMatch({
        source,
        pattern:
          /\b(?:FinanceEvents|FinanceDomainEvent|FinanceNotificationIntents|FINANCE_NOTIFICATION_KEYS|FinanceModule|FinanceFacade)\b/,
        file,
      });
    }
    expect(
      packageDependencies('packages/notifications/package.json'),
    ).not.toContain('@personal-os/finance');
  });

  it('5. Core does not contain Finance event constants or DTOs', () => {
    for (const file of runtimeFiles('packages/core/src')) {
      const source = read(file);
      expectNoMatch({ source, pattern: /finance\.|FINANCE_[A-Z_]+/, file });
      expectNoMatch({
        source,
        pattern:
          /TransactionCreatedEvent|TransactionUpdatedEvent|BudgetThresholdReachedEvent|FinanceTransferCreatedEvent/,
        file,
      });
    }
  });

  it('6. Users does not import Finance configuration validators or defaults', () => {
    for (const file of projectFiles('packages/users/src')) {
      expectNoModuleReference({
        source: read(file),
        modules: ['@personal-os/finance', 'packages/finance'],
        file,
      });
    }

    for (const file of runtimeFiles('packages/users/src')) {
      expectNoMatch({
        source: read(file),
        pattern:
          /\b(?:FINANCE_NOTIFICATION_KEYS|DEFAULT_MODULE_CONFIG_BY_SLUG|validateCardDueDaysBefore|validateSubscriptionReminderDays|resolveCardDueDaysBefore|resolveSubscriptionReminderDays|FINANCE_SETTINGS_DEFAULTS)\b/,
        file,
      });
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
      expectNoMatch({
        source: read(file),
        pattern: /DEFAULT_MODULE_CONFIG_BY_SLUG/,
        file,
      });
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

    expectNoMatch({
      source: read(
        join(repositoryRoot, 'packages/core/src/events/event.constants.ts'),
      ),
      pattern: /\b(?:FinanceEvents|AgendaEvents|ProjectsEvents|HealthEvents)\b/,
      file: 'packages/core/src/events/event.constants.ts',
    });
  });

  it('detects static, dynamic and required imports of a module', () => {
    const references = [
      "import { FinanceModule } from '@personal-os/finance';",
      "import '@personal-os/finance';",
      'import "@personal-os/finance";',
      "const finance = await import('@personal-os/finance');",
      "const finance = require('@personal-os/finance');",
      'const finance = await import(`@personal-os/finance`);',
    ];

    for (const reference of references) {
      expect(() =>
        expectNoModuleReference({
          source: reference,
          modules: ['@personal-os/finance'],
          file: 'fixture.ts',
        }),
      ).toThrow('fixture.ts');
    }

    expect(() =>
      expectNoModuleReference({
        source: "import { AppEvents } from '@personal-os/core';",
        modules: ['@personal-os/finance'],
        file: 'fixture.ts',
      }),
    ).not.toThrow();
  });
});
