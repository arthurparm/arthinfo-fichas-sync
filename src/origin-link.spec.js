import { describe, expect, it } from 'vitest';
import { MODULE_ID } from './module-id.js';
import {
  draftFeatIdsToLocalIds,
  forgetDeletedFeatIds,
  localFeatIdsToDraftIds,
  rememberCreatedFeats,
  rewriteAdvancementOrigin,
  rewriteItemAdvancementOrigin,
  splitAdvancementOrigin,
} from './origin-link.js';

const draftToLocal = new Map([['draftFeat1', 'localFeat1']]);

describe('rewriteAdvancementOrigin', () => {
  it('troca o _id do dote no draft pelo id local e conserva o advancement', () => {
    expect(rewriteAdvancementOrigin('draftFeat1.advSpell', draftToLocal)).toBe('localFeat1.advSpell');
    expect(rewriteAdvancementOrigin('draftFeat1.adv.extra', draftToLocal)).toBe('localFeat1.adv.extra');
  });

  it('preserva origem desconhecida, inclusive o formato atual do site', () => {
    for (const origin of ['clericClass0000.adv', 'outroDote.advSpell', 'sem-ponto', '.adv', 'id.', '', 12, null, undefined]) {
      expect(rewriteAdvancementOrigin(origin, draftToLocal)).toBe(origin);
    }
  });

  it('não reescreve quando o id mapeado é o próprio prefixo', () => {
    expect(rewriteAdvancementOrigin('same.adv', new Map([['same', 'same']]))).toBe('same.adv');
  });

  it('parte no primeiro ponto', () => {
    expect(splitAdvancementOrigin('draftFeat1.advSpell')).toEqual({ id: 'draftFeat1', rest: '.advSpell' });
    expect(splitAdvancementOrigin('clericClass0000.adv')).toEqual({ id: 'clericClass0000', rest: '.adv' });
    expect(splitAdvancementOrigin('sem-ponto')).toBeNull();
  });
});

describe('mapas de dote', () => {
  function feat(id, sourceId, type = 'feat') {
    return {
      id,
      type,
      getFlag: (scope, key) => (scope === MODULE_ID && key === 'sourceId' ? sourceId : undefined),
    };
  }

  it('só o dote com sourceId entra no mapa draft → local', () => {
    const map = draftFeatIdsToLocalIds([
      feat('localFeat1', 'draftFeat1'),
      feat('localClass', 'clericClass0000', 'class'),
      feat('localSolo', undefined),
      feat('localSpell', 'draftSpell', 'spell'),
    ]);
    expect([...map.entries()]).toEqual([['draftFeat1', 'localFeat1']]);
  });

  it('a volta só destraduz dote cujo id local difere do draft', () => {
    const map = localFeatIdsToDraftIds([
      feat('localFeat1', 'draftFeat1'),
      feat('sameId', 'sameId'),
      feat('localClass', 'clericClass0000', 'class'),
    ]);
    expect([...map.entries()]).toEqual([['localFeat1', 'draftFeat1']]);
  });

  it('feat criado devolve o id local e feat apagado sai do mapa', () => {
    const map = new Map([['draftVelho', 'localVelho']]);
    forgetDeletedFeatIds(map, ['localVelho']);
    expect(map.size).toBe(0);
    rememberCreatedFeats([feat('localNovo', 'draftNovo'), feat('localClass', 'cls', 'class')], map);
    expect(map.get('draftNovo')).toBe('localNovo');
    expect(map.has('cls')).toBe(false);
  });

  it('retorno vazio do create não inventa id', () => {
    const map = new Map();
    rememberCreatedFeats(undefined, map);
    expect(map.size).toBe(0);
  });
});

describe('rewriteItemAdvancementOrigin', () => {
  it('muta só a flag quando o prefixo é um dote conhecido', () => {
    const spell = { flags: { dnd5e: { advancementOrigin: 'draftFeat1.advSpell' } } };
    rewriteItemAdvancementOrigin(spell, draftToLocal);
    expect(spell.flags.dnd5e.advancementOrigin).toBe('localFeat1.advSpell');

    const opaque = { flags: { dnd5e: { advancementOrigin: 'clericClass0000.adv' } } };
    rewriteItemAdvancementOrigin(opaque, draftToLocal);
    expect(opaque.flags.dnd5e.advancementOrigin).toBe('clericClass0000.adv');
  });

  it('item sem a flag fica intocado', () => {
    const item = { flags: { dnd5e: {} } };
    rewriteItemAdvancementOrigin(item, draftToLocal);
    expect(item.flags.dnd5e).toEqual({});
    rewriteItemAdvancementOrigin({}, draftToLocal);
  });
});
