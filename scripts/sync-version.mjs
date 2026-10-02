// Versão = função do número de commits (odômetro, 100 por casa):
//   99 commits  -> 0.0.99      100 -> 0.1.0      9999 -> 0.99.99      10000 -> 1.0.0
// Roda no hook pre-commit (ver .githooks/pre-commit) SÓ na branch principal: em branch
// de tarefa o hook não mexe em nada (o merge é squash via PR, então o commit que entra na
// principal não passa pelo hook). A versão "de verdade" de um build é calculada no deploy
// com --print e exposta no /health. Edita package.json, package-lock.json e module.json
// (Foundry), preservando formatação e fim de linha. Não usa `npm version`, que
// seguiria o semver comum (0.0.99 -> 0.0.100).
//
// Uso:
//   node scripts/sync-version.mjs --stage          # grava a versão do próximo commit e faz git add
//   node scripts/sync-version.mjs                  # só grava
//   node scripts/sync-version.mjs --print          # imprime a versão de HEAD (contagem de commits), sem gravar
//   node scripts/sync-version.mjs --check          # confere se os arquivos batem com HEAD (exit 1 se não)
//   node scripts/sync-version.mjs --install-hooks  # git config core.hooksPath .githooks
// Desvio: SKIP_VERSION_BUMP=1 git commit ...  (ex.: `git commit --amend`, que não aumenta a contagem)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function versionFromCount(count) {
  if (!Number.isInteger(count) || count < 0) throw new Error(`contagem inválida: ${count}`);
  const patch = count % 100;
  const minor = Math.floor(count / 100) % 100;
  const major = Math.floor(count / 10000);
  return `${major}.${minor}.${patch}`;
}

const VERSION_RE = /"version":\s*"[^"]*"/;

// package.json / module.json: troca a primeira ocorrência de "version".
export function setVersionInManifest(text, version) {
  if (!VERSION_RE.test(text)) throw new Error('"version" não encontrado');
  let out = text.replace(VERSION_RE, `"version": "${version}"`);
  // module.json do Foundry: o link de download carrega a versão do release.
  out = out.replace(/(\/releases\/download\/v)[0-9][0-9.]*(\/)/, `$1${version}$2`);
  return out;
}

// package-lock.json: só os dois campos do próprio projeto (raiz e packages[""]),
// que ficam nas primeiras linhas; nunca mexe em versão de dependência.
export function setVersionInLock(text, version) {
  const lines = text.split('\n');
  let replaced = 0;
  for (let i = 0; i < Math.min(lines.length, 15) && replaced < 2; i += 1) {
    if (VERSION_RE.test(lines[i])) {
      lines[i] = lines[i].replace(VERSION_RE, `"version": "${version}"`);
      replaced += 1;
    }
  }
  if (replaced === 0) throw new Error('versão do projeto não encontrada no lock');
  return lines.join('\n');
}

const FILES = [
  { path: 'package.json', apply: setVersionInManifest },
  { path: 'package-lock.json', apply: setVersionInLock },
  { path: 'module.json', apply: setVersionInManifest },
];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function commitCount() {
  try {
    return Number(git(['rev-list', '--count', 'HEAD']));
  } catch {
    return 0; // repositório novo, ainda sem nenhum commit
  }
}

// Branch principal do remoto (origin/HEAD); sem remoto, main ou master.
export function defaultBranch() {
  try {
    return git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace('origin/', '');
  } catch {
    return null;
  }
}

export function onDefaultBranch() {
  let current;
  try {
    current = git(['symbolic-ref', '--short', 'HEAD']);
  } catch {
    return false; // HEAD solto (rebase, checkout de tag): não grava versão
  }
  const def = defaultBranch();
  return def ? current === def : current === 'main' || current === 'master';
}

function applyToFiles(version, { write }) {
  const changed = [];
  for (const file of FILES) {
    if (!fs.existsSync(file.path)) continue;
    const raw = fs.readFileSync(file.path, 'utf8');
    const next = file.apply(raw, version);
    if (next !== raw) {
      if (write) fs.writeFileSync(file.path, next);
      changed.push(file.path);
    }
  }
  return changed;
}

function main(argv) {
  if (argv.includes('--install-hooks')) {
    try {
      if (process.env.CI) return;
      git(['rev-parse', '--is-inside-work-tree']);
      git(['config', 'core.hooksPath', '.githooks']);
      console.log('hooks: core.hooksPath = .githooks');
    } catch {
      // fora de um clone git (deploy a partir de tarball): nada a instalar.
    }
    return;
  }

  if (argv.includes('--print')) {
    console.log(versionFromCount(commitCount()));
    return;
  }

  if (argv.includes('--check')) {
    const expected = versionFromCount(commitCount());
    const stale = applyToFiles(expected, { write: false });
    if (stale.length) {
      console.error(`versão fora do padrão (esperado ${expected}): ${stale.join(', ')}`);
      process.exit(1);
    }
    console.log(`versão ok: ${expected}`);
    return;
  }

  if (argv.includes('--stage') && !onDefaultBranch()) {
    console.log('versão: branch de tarefa, não grava (a versão é calculada no deploy)');
    return;
  }

  // O commit em andamento será o (contagem + 1)-ésimo.
  const version = versionFromCount(commitCount() + 1);
  const changed = applyToFiles(version, { write: true });
  if (argv.includes('--stage') && changed.length) {
    execFileSync('git', ['add', ...changed], { stdio: 'inherit' });
  }
  console.log(changed.length ? `versão ${version}: ${changed.join(', ')}` : `versão ${version} (já estava)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main(process.argv.slice(2));
}
