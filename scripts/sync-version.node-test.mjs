// Rodar com: node --test scripts/sync-version.node-test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setVersionInLock, setVersionInManifest, versionFromCount } from './sync-version.mjs';

test('odômetro: 99 vira 0.0.99, 100 vira 0.1.0', () => {
  assert.equal(versionFromCount(0), '0.0.0');
  assert.equal(versionFromCount(1), '0.0.1');
  assert.equal(versionFromCount(99), '0.0.99');
  assert.equal(versionFromCount(100), '0.1.0');
  assert.equal(versionFromCount(101), '0.1.1');
  assert.equal(versionFromCount(123), '0.1.23');
});

test('odômetro: 0.99.99 vira 1.0.0', () => {
  assert.equal(versionFromCount(9999), '0.99.99');
  assert.equal(versionFromCount(10000), '1.0.0');
  assert.equal(versionFromCount(10001), '1.0.1');
  assert.equal(versionFromCount(12345), '1.23.45');
});

test('contagem inválida é recusada', () => {
  assert.throws(() => versionFromCount(-1));
  assert.throws(() => versionFromCount(1.5));
  assert.throws(() => versionFromCount(NaN));
});

test('package.json: troca só a versão e preserva CRLF', () => {
  const src = '{\r\n  "name": "x",\r\n  "version": "1.0.0",\r\n  "scripts": {}\r\n}\r\n';
  const out = setVersionInManifest(src, '0.1.23');
  assert.equal(out, '{\r\n  "name": "x",\r\n  "version": "0.1.23",\r\n  "scripts": {}\r\n}\r\n');
});

test('module.json: atualiza também o link de download do release', () => {
  const src = '{\n  "version": "0.1.0",\n  "download": "https://github.com/o/r/releases/download/v0.1.0/module.zip"\n}';
  const out = setVersionInManifest(src, '0.0.61');
  assert.match(out, /"version": "0.0.61"/);
  assert.match(out, /releases\/download\/v0\.0\.61\/module\.zip/);
});

test('package-lock: só os dois campos do projeto, nunca dependências', () => {
  const src = [
    '{',
    '  "name": "app",',
    '  "version": "1.0.0",',
    '  "lockfileVersion": 3,',
    '  "packages": {',
    '    "": {',
    '      "name": "app",',
    '      "version": "1.0.0",',
    '      "dependencies": {}',
    '    },',
    '    "node_modules/dep": {',
    '      "version": "1.0.0"',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
  const out = setVersionInLock(src, '0.0.45');
  assert.equal((out.match(/"version": "0\.0\.45"/g) || []).length, 2);
  assert.match(out, /node_modules\/dep": \{\n      "version": "1\.0\.0"/);
});

test('sem "version" no manifesto, falha em vez de ignorar', () => {
  assert.throws(() => setVersionInManifest('{"name":"x"}', '0.0.1'));
});
