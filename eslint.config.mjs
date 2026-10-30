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

// Dívida existente (2026-10-30): código de sincronização que só se valida no
// Foundry, então não foi alterado ao introduzir o lint. Fica como aviso e o
// `npm run lint` trava o total com --max-warnings (ver package.json).
const DEBT = {
  'no-useless-assignment': 'warn',
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
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
    rules: DEBT,
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
