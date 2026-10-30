import js from '@eslint/js';
import globals from 'globals';

// Globais que o Foundry VTT injeta no navegador (o módulo roda dentro do VTT).
const foundryGlobals = Object.fromEntries(
  [
    'game',
    'Hooks',
    'ui',
    'foundry',
    'CONFIG',
    'CONST',
    'canvas',
    'Actor',
    'Item',
    'ChatMessage',
    'Roll',
    'Dialog',
    'FormApplication',
    'Handlebars',
    'fromUuid',
    'randomID',
    'duplicate',
  ].map((name) => [name, 'readonly']),
);

// Parâmetro/variável com prefixo _ é intencionalmente não usado (assinatura de hook).
const RULES = {
  'no-useless-assignment': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
};

export default [
  { ignores: ['node_modules/**', 'dist/**', 'packs/**', 'SISTEMA*/**', 'module.zip'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...foundryGlobals },
    },
    rules: RULES,
  },
  {
    // Testes e scripts rodam no Node (global, Buffer...), não dentro do VTT.
    files: ['**/*.spec.js', 'vite.config.js', 'scripts/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...foundryGlobals } },
  },
  {
    // Cópia idêntica nos três repos; não vale divergir só por causa de um regex de teste.
    files: ['scripts/sync-version.node-test.mjs'],
    rules: { 'no-regex-spaces': 'off' },
  },
];
