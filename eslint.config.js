import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', '.etta/', 'coverage/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      complexity: ['error', 10],
      'max-len': [
        'error',
        {
          code: 100,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
        },
      ],
      'max-lines-per-function': ['warn', 80],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['src/**/*.tsx'],
    plugins: {
      'jsx-a11y': jsxA11y,
      'react-hooks': reactHooks,
    },
    rules: {
      ...jsxA11y.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
    },
  },
);
