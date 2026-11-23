import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import noUnsafeSqlLiteral from './eslint-rules/no-unsafe-sql-literal.js';

export default [
  {
    // JavaScript files
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    ignores: ['node_modules', 'dist', 'build', 'eslint-rules/**'],
    plugins: {
      prettier: prettierPlugin,
      import: importPlugin,
      'sql-security': {
        rules: {
          'no-unsafe-sql-literal': noUnsafeSqlLiteral,
        },
      },
    },
    rules: {
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      'no-unused-vars': 'off',
      'no-console': 'off',
      'sql-security/no-unsafe-sql-literal': 'warn',
      // Flag imports of packages/built-ins that cannot be resolved (e.g. typos like 'cypto')
      'import/no-unresolved': ['error', { ignore: ['^node:'] }],
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
      },
    },
  },
  {
    // TypeScript files
    files: ['**/*.ts'],
    ignores: ['node_modules', 'dist', 'build'],
    plugins: {
      prettier: prettierPlugin,
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
    },
    rules: {
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      'no-unused-vars': 'off', // Turn off JS version
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'import/no-unresolved': ['error', { ignore: ['^node:'] }],
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        process: 'readonly',
      },
    },
  },
];
