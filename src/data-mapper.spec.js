import { describe, expect, it } from 'vitest';
import {
  ATTR_MAP,
  ONE_WAY_FOUNDRY_TO_SITE,
  foundrySkillValueToProficiencyLevel,
  proficiencyLevelToFoundrySkillValue,
  readActorSenses,
  readActorTraits,
  readFoundryIdentity,
  readTraitValues,
} from './data-mapper.js';

describe('ATTR_MAP — deslocamento (FDD-47)', () => {
  it('mapeia system.attributes.movement.walk pra identity.movementSpeed, só Foundry -> site', () => {
    expect(ATTR_MAP['system.attributes.movement.walk']).toBe('identity.movementSpeed');
    expect(ONE_WAY_FOUNDRY_TO_SITE.has('system.attributes.movement.walk')).toBe(true);
  });
});

describe('foundrySkillValueToProficiencyLevel', () => {
  it('converte 0 (nao-proficiente) para false', () => {
    expect(foundrySkillValueToProficiencyLevel(0)).toBe(false);
  });

  it('converte 0.5 (meia-proficiencia) para "half" (FDD-10)', () => {
    expect(foundrySkillValueToProficiencyLevel(0.5)).toBe('half');
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

  it('converte "half" para 0.5', () => {
    expect(proficiencyLevelToFoundrySkillValue('half')).toBe(0.5);
  });

  it('faz o ciclo ida-e-volta para todos os niveis que o site representa (FDD-10)', () => {
    for (const level of [false, 'half', true, 'expertise']) {
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
          toolProf: { value: new Set(['thief']) },
          ci: { value: new Set(['charmed']) },
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
      toolProficiencies: [{ label: 'thief' }],
      conditionImmunities: ['charmed'],
      languages: ['common'],
    });
  });

  it('le proficiencia de ferramenta de system.tools (dnd5e moderno), nao so de traits.toolProf (FDD-52)', () => {
    const actor = {
      system: {
        traits: {
          dr: { value: new Set() },
          di: { value: new Set() },
          dv: { value: new Set() },
          armorProf: { value: new Set() },
          weaponProf: { value: new Set() },
          languages: { value: new Set() },
        },
        tools: {
          cartographer: { value: 2, total: 9 },
          thief: { value: 1 },
          herb: { value: 0 },
        },
        attributes: { senses: {} },
      },
    };
    // Sem `dnd5e.documents.Trait.keyLabel` no ambiente de teste (só existe
    // dentro do Foundry), cai pra chave crua — o nome resolvido é coberto
    // ao vivo (ver checkup FDD-52), não dá pra simular a API do sistema aqui.
    const toolProficiencies = readActorTraits(actor).toolProficiencies;
    expect(toolProficiencies.find((t) => t.label === 'cartographer')).toEqual({
      label: 'cartographer',
      modifier: 9,
    });
    expect(toolProficiencies.find((t) => t.label === 'thief')).toEqual({ label: 'thief' });
    expect(toolProficiencies).toHaveLength(2);
  });

  it('ferramenta sem `.total` calculado (ex. dado mockado) fica sem modifier, so label (FDD-61)', () => {
    const actor = {
      system: {
        traits: {
          dr: { value: new Set() },
          di: { value: new Set() },
          dv: { value: new Set() },
          armorProf: { value: new Set() },
          weaponProf: { value: new Set() },
          languages: { value: new Set() },
        },
        tools: { carpenter: { value: 1 } },
        attributes: { senses: {} },
      },
    };
    expect(readActorTraits(actor).toolProficiencies).toEqual([{ label: 'carpenter' }]);
  });

  it('categoria de traits.toolProf nao duplica ferramenta ja presente em system.tools (FDD-61)', () => {
    const actor = {
      system: {
        traits: {
          dr: { value: new Set() },
          di: { value: new Set() },
          dv: { value: new Set() },
          armorProf: { value: new Set() },
          weaponProf: { value: new Set() },
          toolProf: { value: new Set(['cartographer', 'art']) },
          languages: { value: new Set() },
        },
        tools: { cartographer: { value: 2, total: 9 } },
        attributes: { senses: {} },
      },
    };
    const toolProficiencies = readActorTraits(actor).toolProficiencies;
    expect(toolProficiencies).toEqual([{ label: 'cartographer', modifier: 9 }, { label: 'art' }]);
  });

  it('proficiencia de ferramenta e imunidade a condicao ficam vazias sem o recurso no Ator (FDD-52)', () => {
    const actor = {
      system: {
        traits: {
          dr: { value: new Set() },
          di: { value: new Set() },
          dv: { value: new Set() },
          armorProf: { value: new Set() },
          weaponProf: { value: new Set() },
          languages: { value: new Set() },
        },
        attributes: { senses: {} },
      },
    };
    const traits = readActorTraits(actor);
    expect(traits.toolProficiencies).toEqual([]);
    expect(traits.conditionImmunities).toEqual([]);
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
