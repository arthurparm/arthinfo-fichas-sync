import { describe, expect, it } from 'vitest';
import {
  foundrySkillValueToProficiencyLevel,
  proficiencyLevelToFoundrySkillValue,
  readActorSenses,
  readActorTraits,
  readFoundryIdentity,
  readTraitValues,
} from './data-mapper.js';

describe('foundrySkillValueToProficiencyLevel', () => {
  it('converte 0 (nao-proficiente) para false', () => {
    expect(foundrySkillValueToProficiencyLevel(0)).toBe(false);
  });

  it('converte 0.5 (meia-proficiencia) para false (sem equivalente no site)', () => {
    expect(foundrySkillValueToProficiencyLevel(0.5)).toBe(false);
  });

  it('converte 1 (proficiente) para true', () => {
    expect(foundrySkillValueToProficiencyLevel(1)).toBe(true);
  });

  it('converte 2 (expertise) para "expertise"', () => {
    expect(foundrySkillValueToProficiencyLevel(2)).toBe('expertise');
  });
});

describe('proficiencyLevelToFoundrySkillValue', () => {
  it('converte false para 0', () => {
    expect(proficiencyLevelToFoundrySkillValue(false)).toBe(0);
  });

  it('converte true para 1', () => {
    expect(proficiencyLevelToFoundrySkillValue(true)).toBe(1);
  });

  it('converte "expertise" para 2', () => {
    expect(proficiencyLevelToFoundrySkillValue('expertise')).toBe(2);
  });

  it('faz o ciclo ida-e-volta para os niveis que o site representa (true/false/expertise)', () => {
    for (const level of [false, true, 'expertise']) {
      const foundryValue = proficiencyLevelToFoundrySkillValue(level);
      expect(foundrySkillValueToProficiencyLevel(foundryValue)).toBe(level);
    }
  });
});

describe('readTraitValues', () => {
  it('le um Set do Foundry', () => {
    expect(readTraitValues({ value: new Set(['fire', 'cold']) })).toEqual(['fire', 'cold']);
  });

  it('combina value + custom (string separada por ; , ou quebra de linha), sem duplicatas', () => {
    expect(
      readTraitValues({ value: new Set(['fire']), custom: 'fire; cold,\nacid' }),
    ).toEqual(['fire', 'cold', 'acid']);
  });

  it('retorna array vazio quando o trait e null/undefined', () => {
    expect(readTraitValues(null)).toEqual([]);
    expect(readTraitValues(undefined)).toEqual([]);
  });
});

describe('readActorSenses', () => {
  it('le sentidos de system.attributes.senses.ranges (dnd5e 5.3+)', () => {
    const actor = {
      system: { attributes: { senses: { ranges: { darkvision: 60 }, units: 'ft' } } },
    };
    expect(readActorSenses(actor)).toEqual({ darkvision: 60, units: 'ft' });
  });

  it('ignora sentidos com valor 0 ou nao-numerico', () => {
    const actor = {
      system: { attributes: { senses: { ranges: { darkvision: 0, blindsight: 30 } } } },
    };
    expect(readActorSenses(actor)).toEqual({ blindsight: 30 });
  });
});

describe('readActorTraits', () => {
  it('agrega resistencias/imunidades/vulnerabilidades/proficiencias/idiomas', () => {
    const actor = {
      system: {
        traits: {
          dr: { value: new Set(['fire']) },
          di: { value: new Set(['poison']) },
          dv: { value: new Set([]) },
          armorProf: { value: new Set(['lgt']) },
          weaponProf: { value: new Set(['sim']) },
          languages: { value: new Set(['common']) },
        },
        attributes: { senses: {} },
      },
    };
    expect(readActorTraits(actor)).toEqual({
      senses: {},
      damageResistances: ['fire'],
      damageImmunities: ['poison'],
      damageVulnerabilities: [],
      armorProficiencies: ['lgt'],
      weaponProficiencies: ['sim'],
      languages: ['common'],
    });
  });
});

describe('readFoundryIdentity', () => {
  it('resume classe/raca/antecedente sem depender de toObject()', () => {
    const actor = {
      itemTypes: {
        class: [{ id: 'c1', name: 'Guerreiro', system: { identifier: 'fighter', levels: 5, hd: { denomination: 10 } } }],
        race: [{ name: 'Anão' }],
        background: [{ name: 'Soldado' }],
        subclass: [{ name: 'Campeão' }],
      },
      classes: [],
      system: { attributes: { hd: { value: 3, max: 5 } }, traits: { size: 'med' } },
    };

    expect(readFoundryIdentity(actor)).toEqual({
      classes: [{ name: 'Guerreiro', identifier: 'fighter', levels: 5, hitDie: 'd10' }],
      subclassName: 'Campeão',
      raceName: 'Anão',
      backgroundName: 'Soldado',
      size: 'med',
      hitDie: 'd10',
      hitDiceValue: 3,
      hitDiceMax: 5,
    });
  });
});
