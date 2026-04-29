import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

const tsRules = {
  // tsc handles these better than eslint base
  'no-unused-vars': 'off',
  'no-undef': 'off',
  'no-redeclare': 'off',
  '@typescript-eslint/no-unused-vars': [
    'warn',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-non-null-assertion': 'off',
  '@typescript-eslint/no-empty-object-type': 'off',
  '@typescript-eslint/ban-ts-comment': 'off',
};

const sharedRules = {
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'no-debugger': 'error',
  'prefer-const': 'warn',
  eqeqeq: ['warn', 'smart'],
  'no-var': 'error',
};

const nodeGlobals = {
  console: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  NodeJS: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  URL: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  HTMLElement: 'readonly',
  HTMLDivElement: 'readonly',
  HTMLPreElement: 'readonly',
  HTMLTableElement: 'readonly',
  HTMLTableCellElement: 'readonly',
  HTMLAnchorElement: 'readonly',
  HTMLSpanElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLTextAreaElement: 'readonly',
  HTMLScriptElement: 'readonly',
  PointerEvent: 'readonly',
  WheelEvent: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  URL: 'readonly',
  Blob: 'readonly',
  Worker: 'readonly',
  getComputedStyle: 'readonly',
  matchMedia: 'readonly',
  location: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
};

export default [
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'dist/**',
      '*.vsix',
      'plugins/mark-it-down-claude/bin/**',
      'media/**',
      '.vscode-test/**',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'apps/electron/main.ts', 'apps/electron/preload.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: nodeGlobals,
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: { ...sharedRules, ...tsRules },
  },
  {
    files: ['src/webview/**/*.ts', 'apps/electron/renderer/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: browserGlobals,
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: { ...sharedRules, ...tsRules, 'no-console': 'off' },
  },
];
