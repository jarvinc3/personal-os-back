// @ts-check
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const PACKAGE_NAMES = [
  'ai-agent',
  'auth',
  'config',
  'core',
  'database',
  'finance',
  'logos',
  'notifications',
  'users',
];

/** Deep paths into a package's src bypass its public barrel. */
const restrictedPackageDeepPaths = PACKAGE_NAMES.map((name) => ({
  group: [`**/${name}/src/**`],
  message: `Importa ${name} por su barrel @personal-os/${name}, no por rutas internas. Ver docs/architecture/monorepo.md`,
}));

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      '**/dist/**',
      'packages/database/src/generated/**',
    ],
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
      'packages/auth/src/infrastructure/jwks-rsa.loader.ts',
      'packages/ai-agent/src/ai.module.ts',
      'packages/ai-agent/src/ai-core.module.ts',
      'test/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts', 'test/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: restrictedPackageDeepPaths,
        },
      ],
    },
  },
  {
    // Money in the read paths stays decimal end to end (ADR-002, pendiente 13).
    // shared/domain/money.ts owns the only number boundary, for ratios.
    files: [
      'packages/finance/src/analytics/application/**/*.ts',
      'packages/finance/src/balance-sheet/application/**/*.ts',
      'packages/finance/src/fx/application/**/*.ts',
      'packages/finance/src/subscriptions/application/**/*.ts',
      'packages/finance/src/subscriptions/domain/billing.ts',
    ],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name="toNumber"]',
          message:
            'Los montos se suman y convierten con los helpers decimales de shared/domain/money.ts, no con number.',
        },
        {
          selector: 'CallExpression[callee.name="Number"]',
          message:
            'Los montos se suman y convierten con los helpers decimales de shared/domain/money.ts, no con number.',
        },
      ],
    },
  },
  {
    rules: {
      curly: ['error', 'all'],
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
