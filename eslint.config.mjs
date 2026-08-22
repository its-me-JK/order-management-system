import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const prismaBoundaryMessage =
  'Prisma is an infrastructure detail. Import it only from a database composition root or a business module infrastructure adapter; other layers must depend on application-owned ports.';
const databaseClientTokenBoundaryMessage =
  'The concrete database client token is infrastructure-only. Domain, application, and presentation layers must inject application-owned ports.';

const prismaImportRestrictions = {
  paths: [
    {
      message: prismaBoundaryMessage,
      name: '@oms/database/prisma',
    },
    {
      message: prismaBoundaryMessage,
      name: '@prisma/client',
    },
  ],
  patterns: [
    {
      group: [
        '@oms/database/prisma/*',
        '@prisma/*',
        '@prisma/*/**',
        '**/generated/prisma',
        '**/generated/prisma/**',
      ],
      message: prismaBoundaryMessage,
    },
    {
      group: ['**/database/database.tokens', '**/database/database.tokens.*'],
      importNames: ['DATABASE_CLIENT'],
      message: databaseClientTokenBoundaryMessage,
    },
  ],
};

const prismaDynamicImportRestrictions = [
  {
    message: prismaBoundaryMessage,
    selector: 'ImportExpression[source.value=/^@oms\\/database\\/prisma(?:\\/|$)/]',
  },
  {
    message: prismaBoundaryMessage,
    selector: 'ImportExpression[source.value=/^@prisma\\//]',
  },
  {
    message: prismaBoundaryMessage,
    selector: 'ImportExpression[source.value=/(?:^|\\/)generated\\/prisma(?:\\/|$)/]',
  },
  {
    message: prismaBoundaryMessage,
    selector:
      "CallExpression[callee.name='require'] > Literal.arguments[value=/^@oms\\/database\\/prisma(?:\\/|$)/]",
  },
  {
    message: prismaBoundaryMessage,
    selector: "CallExpression[callee.name='require'] > Literal.arguments[value=/^@prisma\\//]",
  },
  {
    message: prismaBoundaryMessage,
    selector:
      "CallExpression[callee.name='require'] > Literal.arguments[value=/(?:^|\\/)generated\\/prisma(?:\\/|$)/]",
  },
  {
    message: databaseClientTokenBoundaryMessage,
    selector:
      'ImportDeclaration[source.value=/\\/database\\/database\\.tokens(?:\\.[^/]+)?$/] > ImportNamespaceSpecifier',
  },
  {
    message: databaseClientTokenBoundaryMessage,
    selector: 'ImportExpression[source.value=/\\/database\\/database\\.tokens(?:\\.[^/]+)?$/]',
  },
  {
    message: databaseClientTokenBoundaryMessage,
    selector:
      "CallExpression[callee.name='require'] > Literal.arguments[value=/\\/database\\/database\\.tokens(?:\\.[^/]+)?$/]",
  },
];

const businessLoggingRestrictions = {
  paths: [
    {
      importNames: ['ConsoleLogger', 'Logger'],
      message: 'Business features must use the application-owned logging port with stable events.',
      name: '@nestjs/common',
    },
  ],
  patterns: [
    {
      group: ['nestjs-pino', 'nestjs-pino/*', 'pino', 'pino/*', 'pino-http', 'pino-http/*'],
      message:
        'Business features must depend on the application-owned logging port, not a logging vendor.',
    },
  ],
};

const prismaInfrastructureFiles = [
  'packages/database/src/**/*.ts',
  'packages/database/test/**/*.ts',
  'packages/database/prisma/**/*.ts',
  'packages/database/prisma.config.ts',
  'packages/modules/**/infrastructure/**/*.ts',
  'apps/api/src/main.ts',
  'apps/api/src/api.module.ts',
  'apps/api/src/platform/database/**/*.ts',
  'apps/worker/src/main.ts',
  'apps/worker/src/worker.module.ts',
  'apps/worker/src/platform/database/**/*.ts',
];

export default tseslint.config(
  {
    ignores: [
      '**/coverage/**',
      '**/dist/**',
      '**/.integration-dist/**',
      '**/node_modules/**',
      '**/src/generated/prisma/**',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          fixStyle: 'inline-type-imports',
          prefer: 'type-imports',
        },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    files: ['**/*.module.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    files: ['**/*.ts'],
    ignores: prismaInfrastructureFiles,
    rules: {
      'no-restricted-imports': ['error', prismaImportRestrictions],
      'no-restricted-syntax': ['error', ...prismaDynamicImportRestrictions],
    },
  },
  {
    files: ['packages/modules/**/*.ts', 'apps/api/src/features/**/*.ts'],
    ignores: ['packages/modules/**/infrastructure/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...businessLoggingRestrictions.paths, ...prismaImportRestrictions.paths],
          patterns: [...businessLoggingRestrictions.patterns, ...prismaImportRestrictions.patterns],
        },
      ],
      'no-console': 'error',
    },
  },
  {
    files: ['packages/modules/**/infrastructure/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', businessLoggingRestrictions],
      'no-console': 'error',
    },
  },
  prettier,
);
