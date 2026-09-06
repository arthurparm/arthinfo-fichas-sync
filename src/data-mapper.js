// foundry-module/src/data-mapper.js

/**
 * Mapeamento bidirecional das propriedades entre Firebase (Web) e Foundry VTT.
 * A chave é o path do Foundry (dot-notation), e o valor é o path correspondente no Firebase.
 */
export const ATTR_MAP = {
  // --- Atributos Básicos ---
  'system.abilities.str.value': 'attributes.scores.strength',
  'system.abilities.dex.value': 'attributes.scores.dexterity',
  'system.abilities.con.value': 'attributes.scores.constitution',
  'system.abilities.int.value': 'attributes.scores.intelligence',
  'system.abilities.wis.value': 'attributes.scores.wisdom',
  'system.abilities.cha.value': 'attributes.scores.charisma',

  // --- Pontos de Vida (HP) ---
  'system.attributes.hp.max': 'derivedStats.maxHp',
  'system.attributes.hp.value': 'derivedStats.currentHp',
  'system.attributes.hp.temp': 'derivedStats.tempHp',

  // --- Classe de Armadura (AC) ---
  'system.attributes.ac.value': 'derivedStats.ac',

  // --- Moedas (Currency) ---
  'system.currency.cp': 'currency.cp',
  'system.currency.sp': 'currency.sp',
  'system.currency.ep': 'currency.ep',
  'system.currency.gp': 'currency.gp',
  'system.currency.pp': 'currency.pp',

  // --- Slots de Magia (Spellcasting) ---
  'system.spells.spell1.value': 'spellSlots.level1.current',
  'system.spells.spell1.max': 'spellSlots.level1.max',
  'system.spells.spell2.value': 'spellSlots.level2.current',
  'system.spells.spell2.max': 'spellSlots.level2.max',
  'system.spells.spell3.value': 'spellSlots.level3.current',
  'system.spells.spell3.max': 'spellSlots.level3.max',
  'system.spells.spell4.value': 'spellSlots.level4.current',
  'system.spells.spell4.max': 'spellSlots.level4.max',
  'system.spells.spell5.value': 'spellSlots.level5.current',
  'system.spells.spell5.max': 'spellSlots.level5.max',
  'system.spells.spell6.value': 'spellSlots.level6.current',
  'system.spells.spell6.max': 'spellSlots.level6.max',
  'system.spells.spell7.value': 'spellSlots.level7.current',
  'system.spells.spell7.max': 'spellSlots.level7.max',
  'system.spells.spell8.value': 'spellSlots.level8.current',
  'system.spells.spell8.max': 'spellSlots.level8.max',
  'system.spells.spell9.value': 'spellSlots.level9.current',
  'system.spells.spell9.max': 'spellSlots.level9.max',
  'system.spells.pact.value': 'spellSlots.pact.current',
  'system.spells.pact.max': 'spellSlots.pact.max',

  // --- Recursos Personalizados (Primário, Secundário, Terciário) ---
  'system.resources.primary.value': 'resources.primary.current',
  'system.resources.primary.max': 'resources.primary.max',
  'system.resources.primary.label': 'resources.primary.name',
  'system.resources.secondary.value': 'resources.secondary.current',
  'system.resources.secondary.max': 'resources.secondary.max',
  'system.resources.secondary.label': 'resources.secondary.name',
  'system.resources.tertiary.value': 'resources.tertiary.current',
  'system.resources.tertiary.max': 'resources.tertiary.max',
  'system.resources.tertiary.label': 'resources.tertiary.name',

  // --- Testes de morte e exaustão ---
  'system.attributes.death.success': 'derivedStats.deathSaveSuccesses',
  'system.attributes.death.failure': 'derivedStats.deathSaveFailures',
  'system.attributes.exhaustion': 'derivedStats.exhaustion'
};

// Sentidos do dnd5e 5.3+ vivem em system.attributes.senses.ranges.*; versões
// antigas ainda têm darkvision/blindsight/etc. no próprio senses. Não cabem
// bem no ATTR_MAP (0 vs ausente, e o caminho mudou) — ver readActorSenses.
export const SENSE_KEYS = ['darkvision', 'blindsight', 'tremorsense', 'truesight'];

// Listas de traço do Ator (Set no Foundry, array no draft). Foundry -> site
// só; a ficha não edita esses campos, então não voltam pelo ATTR_MAP.
export const TRAIT_LIST_PATHS = {
  damageResistances: 'system.traits.dr',
  damageImmunities: 'system.traits.di',
  damageVulnerabilities: 'system.traits.dv',
  armorProficiencies: 'system.traits.armorProf',
  weaponProficiencies: 'system.traits.weaponProf',
  languages: 'system.traits.languages'
};

function toStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value instanceof Set) return [...value].filter(Boolean).map(String);
  if (typeof value === 'object') return Object.keys(value).filter((key) => value[key]);
  return [];
}

export function readTraitValues(trait) {
  if (!trait) return [];
  const fromValue = toStringList(trait.value ?? (Array.isArray(trait) || trait instanceof Set ? trait : null));
  const custom = typeof trait.custom === 'string'
    ? trait.custom.split(/[;,\n]/).map((entry) => entry.trim()).filter(Boolean)
    : [];
  return [...new Set([...fromValue, ...custom])];
}

export function readActorSenses(actor) {
  const senses = actor.system?.attributes?.senses ?? {};
  const ranges = senses.ranges ?? {};
  const result = {};
  for (const key of SENSE_KEYS) {
    const value = ranges[key] ?? senses[key];
    if (typeof value === 'number' && value > 0) result[key] = value;
  }
  if (senses.units) result.units = senses.units;
  if (typeof senses.special === 'string' && senses.special.trim()) {
    result.special = senses.special.trim();
  }
  return result;
}

export function readActorTraits(actor) {
  const traits = actor.system?.traits ?? {};
  return {
    senses: readActorSenses(actor),
    damageResistances: readTraitValues(traits.dr),
    damageImmunities: readTraitValues(traits.di),
    damageVulnerabilities: readTraitValues(traits.dv),
    armorProficiencies: readTraitValues(traits.armorProf),
    weaponProficiencies: readTraitValues(traits.weaponProf),
    languages: readTraitValues(traits.languages)
  };
}

function asItemArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.length === 'number' || typeof value[Symbol.iterator] === 'function') {
    return [...value];
  }
  if (typeof value === 'object') return Object.values(value);
  return [];
}

function itemsOfType(actor, type) {
  const typed = asItemArray(actor.itemTypes?.[type]);
  if (typed.length > 0) return typed;
  const list = asItemArray(actor.items?.contents ?? actor.items);
  return list.filter((item) => item?.type === type);
}

function embeddedName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.name || '';
}

function hitDieOf(item) {
  const raw = item?.system?.hd?.denomination ?? item?.system?.hitDice ?? item?.system?.hitDie;
  if (typeof raw === 'number' && raw > 0) return `d${raw}`;
  if (typeof raw === 'string' && raw.trim()) {
    const value = raw.trim();
    return value.startsWith('d') ? value : `d${value}`;
  }
  return '';
}

function actorHitDice(actor) {
  const hd = actor.system?.attributes?.hd;
  if (!hd) return { value: 0, max: 0 };
  const value = Number(hd.value);
  const max = Number(hd.max);
  return {
    value: Number.isFinite(value) ? value : 0,
    max: Number.isFinite(max) ? max : 0,
  };
}

// Resumo leve de classe/raça/antecedente — não depende do toObject() do
// item de classe (que no dnd5e carrega advancement enorme e às vezes
// falha/some do array de items). O cabeçalho da ficha lê isto.
export function readFoundryIdentity(actor) {
  const fromTypes = itemsOfType(actor, 'class');
  const fromMap = asItemArray(actor.classes);
  const seen = new Set();
  const classItems = [];
  for (const item of [...fromTypes, ...fromMap]) {
    const id = item?.id || item?.name;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    classItems.push(item);
  }

  const raceItem = itemsOfType(actor, 'race')[0];
  const backgroundItem = itemsOfType(actor, 'background')[0];
  const subclassItem = itemsOfType(actor, 'subclass')[0];
  const hitDice = actorHitDice(actor);
  const size = actor.system?.traits?.size || '';

  return {
    classes: classItems.map((item) => ({
      name: item.name || '',
      identifier: item.system?.identifier || item.identifier || '',
      levels: Number(item.system?.levels) || 0,
      hitDie: hitDieOf(item),
    })),
    subclassName: subclassItem?.name || '',
    raceName: raceItem?.name || embeddedName(actor.system?.details?.race),
    backgroundName: backgroundItem?.name || embeddedName(actor.system?.details?.background),
    size,
    hitDie: classItems.map(hitDieOf).find(Boolean) || '',
    hitDiceValue: hitDice.value,
    hitDiceMax: hitDice.max,
  };
}

function filledString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

// Biografia do Ator (aba Biography do dnd5e2). Foundry -> site, unidirecional:
// strings livres, HTML em biography.value. Só devolve campos preenchidos.
export function readFoundryBiography(actor) {
  const details = actor.system?.details ?? {};
  const identity = {};
  const description = {};

  const appearance = filledString(details.appearance);
  const age = filledString(details.age);
  const gender = filledString(details.gender);
  const height = filledString(details.height);
  const weight = filledString(details.weight);
  const eyes = filledString(details.eyes);
  const hair = filledString(details.hair);
  const skin = filledString(details.skin);
  if (appearance) identity.appearance = appearance;
  if (age) identity.age = age;
  if (gender) identity.sex = gender;
  if (height) identity.height = height;
  if (weight) identity.weight = weight;
  if (eyes) identity.eyes = eyes;
  if (hair) identity.hair = hair;
  if (skin) identity.skin = skin;

  const alignment = filledString(details.alignment);
  const faith = filledString(details.faith);
  const ideal = filledString(details.ideal);
  const bond = filledString(details.bond);
  const flaw = filledString(details.flaw);
  const trait = filledString(details.trait);
  const backstory = filledString(details.biography?.value);
  if (alignment) description.alignment = alignment;
  if (faith) description.faith = faith;
  if (ideal) description.ideal = ideal;
  if (bond) description.bond = bond;
  if (flaw) description.flaw = flaw;
  if (trait) description.trait = trait;
  if (backstory) description.backstory = backstory;

  return { identity, description };
}

/**
 * Lista de habilidades para processamento especial de bônus racial
 */
export const ABILITY_KEYS = [
  { foundry: 'str', firebase: 'strength' },
  { foundry: 'dex', firebase: 'dexterity' },
  { foundry: 'con', firebase: 'constitution' },
  { foundry: 'int', firebase: 'intelligence' },
  { foundry: 'wis', firebase: 'wisdom' },
  { foundry: 'cha', firebase: 'charisma' }
];

/**
 * Perícias do dnd5e (Foundry) e o SkillId correspondente no site — mesmos 18
 * IDs de core/rules/skills.ts do rpg-runarcana-ficha. Processamento especial
 * (não cabe no ATTR_MAP genérico) porque o valor não é um booleano simples:
 * o Foundry usa 0/0.5/1/2 (não-proficiente/meia-proficiência/proficiente/
 * expertise), o site usa `ProficiencyLevel` (boolean | 'expertise'). A
 * meia-proficiência não tem equivalente no site e vira `false` ao sincronizar
 * Foundry → site.
 */
export const SKILL_KEY_MAP = [
  { foundry: 'acr', id: 'acrobatics' },
  { foundry: 'ani', id: 'animal-handling' },
  { foundry: 'arc', id: 'arcana' },
  { foundry: 'ath', id: 'athletics' },
  { foundry: 'dec', id: 'deception' },
  { foundry: 'his', id: 'history' },
  { foundry: 'ins', id: 'insight' },
  { foundry: 'itm', id: 'intimidation' },
  { foundry: 'inv', id: 'investigation' },
  { foundry: 'med', id: 'medicine' },
  { foundry: 'nat', id: 'nature' },
  { foundry: 'prc', id: 'perception' },
  { foundry: 'prf', id: 'performance' },
  { foundry: 'per', id: 'persuasion' },
  { foundry: 'rel', id: 'religion' },
  { foundry: 'slt', id: 'sleight-of-hand' },
  { foundry: 'ste', id: 'stealth' },
  { foundry: 'sur', id: 'survival' }
];

/**
 * Converte o valor de perícia do Foundry (0/0.5/1/2) pro `ProficiencyLevel`
 * do site (`boolean | 'expertise'`). Meia-proficiência não tem equivalente
 * no site e vira `false`.
 */
export function foundrySkillValueToProficiencyLevel(value) {
  if (value >= 2) return 'expertise';
  if (value >= 1) return true;
  return false;
}

/**
 * Converte o `ProficiencyLevel` do site (`boolean | 'expertise'`) pro valor
 * de perícia do Foundry (0/1/2). Direção inversa de
 * `foundrySkillValueToProficiencyLevel` — não é uma volta perfeita pra
 * meia-proficiência (0.5), que o site não representa.
 */
export function proficiencyLevelToFoundrySkillValue(level) {
  if (level === 'expertise') return 2;
  return level ? 1 : 0;
}
