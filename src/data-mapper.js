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
  'system.resources.tertiary.label': 'resources.tertiary.name'
};

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
