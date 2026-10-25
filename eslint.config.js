import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '**/node_modules/**',
      '.wrangler/**',
      '**/test-results/**',
      // Playwright / Vite run-time temp scripts (regenerated per run; not source).
      '**/.tmp-*',
      'web/playwright-report/**',
      'web/public/**',
      // generated + ambient declarations
      'src/worker/schema-ddl.ts',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // svelte components & runes modules: type-aware parsing for <script lang="ts">
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    // TypeScript already reports undefined identifiers, and `no-undef` cannot see
    // DOM/TS types (ParentNode, HTMLImageElement, …) in Svelte scripts — it only
    // produces false positives there. tseslint's eslint-recommended override covers
    // *.ts but not *.svelte, so the rule is switched off for Svelte explicitly.
    files: ['**/*.svelte', '**/*.svelte.ts'],
    rules: { 'no-undef': 'off' },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // a11y / compile diagnostics are gated by svelte-check --fail-on-warnings
      'svelte/valid-compile': 'off',
      // These three demand Svelte-specific refactors (SvelteMap/SvelteSet,
      // writable-$derived, no direct DOM writes) with behavior implications
      // in hot components; markdown rendering needs sanitized innerHTML.
      'svelte/prefer-svelte-reactivity': 'off',
      'svelte/no-unused-svelte-ignore': 'off',
      'svelte/prefer-writable-derived': 'off',
      'svelte/no-dom-manipulating': 'off',
    },
  },
  {
    // `console` is the Worker's and the client's only diagnostic channel — catch paths log,
    // and the upload trace lines are gated on `import.meta.env.DEV` — so the rule stays off
    // with no per-directory exception to keep in sync.
    rules: { 'no-console': 'off' },
  },
  prettier,
);
