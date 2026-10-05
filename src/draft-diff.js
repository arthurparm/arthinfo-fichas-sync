// Calcula o PATCH (FDD-78) entre a última ficha conhecida do servidor e a ficha
// com o overlay do Ator aplicado. Só descreve caminhos que a API aceita (a
// allowlist de arthinfo-fichas-api/src/draft-patch.js); qualquer diferença fora
// dela faz buildPatch devolver UNSUPPORTED, e o chamador cai pro PUT inteiro em
// vez de perder a mudança.

import { ABILITY_KEYS, SKILL_KEY_MAP } from './data-mapper.js';

export const UNSUPPORTED = Symbol('unsupported');

const SLOT_KEYS = [...Array.from({ length: 9 }, (_, i) => `level${i + 1}`), 'pact'];
const RESOURCE_KEYS = ['primary', 'secondary', 'tertiary'];

const SCALAR_PATHS = [
  ...[
    'currentHp',
    'tempHp',
    'maxHp',
    'initiative',
    'ac',
    'deathSaveSuccesses',
    'deathSaveFailures',
    'exhaustion',
  ].map((key) => `derivedStats.${key}`),
  ...['cp', 'sp', 'ep', 'gp', 'pp'].map((key) => `currency.${key}`),
  ...SLOT_KEYS.flatMap((slot) => [`spellSlots.${slot}.current`, `spellSlots.${slot}.max`]),
  ...RESOURCE_KEYS.flatMap((res) => [
    `resources.${res}.current`,
    `resources.${res}.max`,
    `resources.${res}.name`,
  ]),
  'identity.movementSpeed',
  ...ABILITY_KEYS.map(({ firebase }) => `attributes.scores.${firebase}`),
  ...['appearance', 'age', 'sex', 'height', 'weight', 'eyes', 'hair', 'skin'].map(
    (key) => `identity.${key}`,
  ),
  ...['alignment', 'faith', 'ideal', 'bond', 'flaw', 'trait', 'backstory'].map(
    (key) => `description.${key}`,
  ),
  'concept.name',
  'concept.portraitUrl',
  'spellcasting.ability',
  ...ABILITY_KEYS.map(({ firebase }) => `proficiencies.savingThrows.${firebase}`),
  ...SKILL_KEY_MAP.map(({ id }) => `proficiencies.skills.${id}`),
];

// Substituídos inteiros quando mudam (sem id estável por elemento).
const WHOLE_PATHS = ['conditions', 'effects', 'traits', 'foundryIdentity'];

function getPath(object, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}

function setPath(object, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let cursor = object;
  for (const key of keys) {
    if (cursor[key] === undefined || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[last] = value;
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((entry, index) => deepEqual(entry, b[index]));
  }
  const keysA = Object.keys(a).filter((key) => a[key] !== undefined);
  const keysB = Object.keys(b).filter((key) => b[key] !== undefined);
  return keysA.length === keysB.length && keysA.every((key) => deepEqual(a[key], b[key]));
}

function diffItems(before, after) {
  const prev = Array.isArray(before) ? before : [];
  const next = Array.isArray(after) ? after : [];
  const ids = [...prev, ...next].map((item) => item?._id);
  if (ids.some((id) => typeof id !== 'string' || !id)) return UNSUPPORTED;
  if (new Set(next.map((item) => item._id)).size !== next.length) return UNSUPPORTED;

  const prevById = new Map(prev.map((item) => [item._id, item]));
  const nextIds = new Set(next.map((item) => item._id));
  const upsert = next.filter((item) => !deepEqual(prevById.get(item._id), item));
  const remove = prev.filter((item) => !nextIds.has(item._id)).map((item) => item._id);
  return { upsert, remove };
}

/**
 * @returns {{set?: object, lists?: object} | null | typeof UNSUPPORTED}
 *   null = nada mudou (não precisa chamar a API).
 */
export function buildPatch(before, after) {
  const set = {};
  for (const path of SCALAR_PATHS) {
    const next = getPath(after, path);
    if (next === undefined) continue; // overlay não tocou: não apaga
    if (!deepEqual(getPath(before, path), next)) set[path] = next;
  }
  for (const path of WHOLE_PATHS) {
    const next = after[path];
    if (next === undefined) continue;
    if (!deepEqual(before[path], next)) set[path] = next;
  }

  const patch = {};
  if (Object.keys(set).length) patch.set = set;

  if (after.items !== undefined || before.items !== undefined) {
    const items = diffItems(before.items, after.items);
    if (items === UNSUPPORTED) return UNSUPPORTED;
    if (items.upsert.length || items.remove.length) patch.lists = { items };
  }

  if (!patch.set && !patch.lists) {
    // Nada na allowlist mudou. Se mesmo assim a ficha difere, é um campo que o
    // PATCH não cobre: manda o PUT.
    return deepEqual(before, after) ? null : UNSUPPORTED;
  }

  // Rede de segurança: o patch precisa reproduzir exatamente a ficha pretendida.
  // Se o overlay passar a escrever algo fora da allowlist, cai no PUT em vez de
  // perder a mudança em silêncio.
  return deepEqual(applyPatchLocally(before, patch), after) ? patch : UNSUPPORTED;
}

export function applyPatchLocally(base, patch) {
  const next = structuredClone(base);
  for (const [path, value] of Object.entries(patch.set ?? {})) setPath(next, path, structuredClone(value));
  if (patch.lists?.items) {
    const { upsert = [], remove = [] } = patch.lists.items;
    const removed = new Set(remove);
    const byId = new Map(upsert.map((item) => [item._id, item]));
    const used = new Set();
    const items = [];
    for (const item of next.items ?? []) {
      if (removed.has(item._id)) continue;
      if (byId.has(item._id)) {
        items.push(structuredClone(byId.get(item._id)));
        used.add(item._id);
      } else {
        items.push(item);
      }
    }
    for (const item of upsert) if (!used.has(item._id)) items.push(structuredClone(item));
    next.items = items;
  }
  return next;
}
