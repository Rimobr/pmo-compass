// Lint do app (um arquivo HTML com 113 módulos) e dos scripts/testes. Começa só pelos erros graves; novas regras entram aos poucos.
import html from 'eslint-plugin-html';

const graves = {
  'no-dupe-keys': 'error', 'no-dupe-args': 'error', 'no-dupe-else-if': 'error', 'no-duplicate-case': 'error',
  'no-unreachable': 'error', 'no-const-assign': 'error', 'no-func-assign': 'error', 'no-class-assign': 'error',
  'no-self-assign': 'error', 'no-unsafe-negation': 'error', 'no-unsafe-finally': 'error', 'use-isnan': 'error',
  'valid-typeof': 'error', 'no-sparse-arrays': 'error', 'no-empty-character-class': 'error', 'no-invalid-regexp': 'error',
  'no-obj-calls': 'error', 'no-setter-return': 'error', 'getter-return': 'error', 'no-unsafe-optional-chaining': 'error',
  'no-compare-neg-zero': 'error', 'no-loss-of-precision': 'error', 'no-import-assign': 'error', 'no-async-promise-executor': 'error'
};

export default [
  { ignores: ['node_modules/**', 'playwright-report/**', 'test-results/**', 'bugs-export/**', 'supabase/functions/**'] },
  { files: ['PMO_Compass_v2.html'], plugins: { html }, languageOptions: { ecmaVersion: 2023, sourceType: 'script' }, rules: graves },
  { files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'tests/**/*.js', 'eslint.config.mjs'], languageOptions: { ecmaVersion: 2023, sourceType: 'module' }, rules: graves }
];
