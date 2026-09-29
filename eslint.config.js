import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import noCrossPackageRelativeImport from './tooling/eslint/no-cross-package-relative-import.js';
import noHardcodedJsxString from './tooling/eslint/no-hardcoded-jsx-string.js';

// Package import rules from docs/ARCHITECTURE.md (M1-7).
// Each rule covers the package and all its subpaths (`@macrofill/web/src/...`).
/** @type {(name: string, message: string) => { group: string[], message: string }} */
const restrictedPackage = (name, message) => ({ group: [name, `${name}/**`], message });

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/coverage/',
      'test-results/',
      'playwright-report/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      local: {
        rules: {
          'no-cross-package-relative-import': noCrossPackageRelativeImport,
          'no-hardcoded-jsx-string': noHardcodedJsxString,
        },
      },
    },
    rules: {
      'local/no-cross-package-relative-import': 'error',
    },
  },
  {
    // domain's own tsconfig has no Node types, so its tests use a separate one.
    files: ['packages/domain/test/**/*.ts', 'packages/domain/vitest.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './packages/domain/tsconfig.test.json',
      },
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!(zod(/.*)?|\\.\\.?(/.*)?)$)',
              message: 'domain imports only zod (docs/ARCHITECTURE.md).',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'domain has no clock. Pass time in.' },
        { object: 'Math', property: 'random', message: 'domain has no randomness. Pass IDs in.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'domain has no clock. Pass time in.',
        },
        {
          // Date() without `new` returns the current time as a string.
          selector: "CallExpression[callee.name='Date']",
          message: 'domain has no clock. Pass time in.',
        },
      ],
    },
  },
  {
    files: ['packages/scale/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            restrictedPackage('@macrofill/api', 'scale must not import apps.'),
            restrictedPackage('@macrofill/web', 'scale must not import apps.'),
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            restrictedPackage('@macrofill/scale', 'api never imports scale.'),
            restrictedPackage('@macrofill/web', 'api must not import web.'),
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // M5-10: UI text comes from the i18n catalog.
      'local/no-hardcoded-jsx-string': 'error',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@macrofill/api', '@macrofill/api/**'],
              allowTypeImports: true,
              message: 'web imports api with `import type` only.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
