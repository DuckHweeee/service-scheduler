import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['.claude/**', '**/dist/**', '**/coverage/**', '**/reports/**', '**/.stryker-tmp/**', '**/node_modules/**', 'design/**', '.pgdata/**', '**/drizzle/meta/**', '**/mockServiceWorker.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
