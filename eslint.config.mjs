// @ts-check
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const moduleBoundaryMessage =
  'Import from the module public API (index.ts / façade), not internal layers. See docs/architecture/modules.md';

/** Cross-module deep paths into layered folders (relative or absolute). */
const restrictedModuleLayerPatterns = [
  {
    group: [
      '**/users/domain/**',
      '**/users/infrastructure/**',
      '**/users/presentation/**',
      '**/users/application/**',
      '**/users/users.module',
      '**/users/users.service',
      '**/users/users.repository',
      '**/users/users.controller',
    ],
    message: `${moduleBoundaryMessage} (use modules/users).`,
  },
  {
    group: [
      '**/auth/domain/**',
      '**/auth/infrastructure/**',
      '**/auth/presentation/**',
      '**/auth/auth.module',
      '**/auth/auth.controller',
    ],
    message: `${moduleBoundaryMessage} (use modules/auth).`,
  },
  {
    group: [
      '**/notifications/domain/**',
      '**/notifications/infrastructure/**',
      '**/notifications/presentation/**',
      '**/notifications/application/**',
      '**/notifications/notifications.module',
    ],
    message: `${moduleBoundaryMessage} (use modules/notifications).`,
  },
  {
    group: [
      '**/ai-agent/chat/**',
      '**/ai-agent/actions/**',
      '**/ai-agent/runtime/**',
      '**/ai-agent/shared/**',
      '**/ai-agent/tools/**',
      '**/ai-agent/prompts/**',
      '**/ai-agent/providers/**',
      '**/ai-agent/ai.module',
      '**/ai-agent/ai-core.module',
      '**/ai-agent/ai.service',
    ],
    message: `${moduleBoundaryMessage} (use modules/ai-agent).`,
  },
  {
    group: [
      '**/finance/ledger/**',
      '**/finance/catalog/**',
      '**/finance/planning/**',
      '**/finance/analytics/**',
      '**/finance/fx/**',
      '**/finance/ingestion/**',
      '**/finance/events/**',
      '**/finance/shared/**',
      '**/finance/constants/**',
      '**/finance/finance.module',
      '**/finance/finance.facade',
    ],
    message: `${moduleBoundaryMessage} (use modules/finance).`,
  },
];

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: [
      'src/modules/auth/infrastructure/jwks-rsa.loader.ts',
      'src/modules/ai-agent/ai.module.ts',
      'src/modules/ai-agent/ai-core.module.ts',
      'test/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    ignores: [
      // Intra-module files may import their own layers; restriction targets
      // import *strings* containing other modules' layer paths.
      // Module index barrels re-export internals by design.
      'src/modules/users/index.ts',
      'src/modules/auth/index.ts',
      'src/modules/notifications/index.ts',
      'src/modules/ai-agent/index.ts',
      'src/modules/finance/index.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: restrictedModuleLayerPatterns,
        },
      ],
    },
  },
  {
    // Finance capability modules may import sibling capabilities / shared.
    files: ['src/modules/finance/**/*.ts'],
    ignores: ['src/modules/finance/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: restrictedModuleLayerPatterns.filter(
            (p) => !String(p.message).includes('modules/finance'),
          ),
        },
      ],
    },
  },
  {
    // Each module may import its own internal layers via relative paths
    // that do not include the foreign module segment (e.g. ../domain/...).
    // No extra override needed — patterns require users/domain, auth/…, etc.
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      // NestJS decorators (e.g. @Module) are not fully typed for type-aware linting
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
