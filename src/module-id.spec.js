import { describe, expect, it, vi } from 'vitest';
import {
  LEGACY_MODULE_ID,
  MODULE_ID,
  adoptLegacyModuleFlags,
  clearFlag,
  legacyModuleFlagDeletions,
  readFlag,
} from './module-id.js';

describe('MODULE_ID', () => {
  it('mudou do id antigo para o novo', () => {
    expect(MODULE_ID).toBe('arthinfo-fichas-sync');
    expect(LEGACY_MODULE_ID).toBe('runarcana-sync');
  });
});

describe('readFlag', () => {
  it('lê do escopo novo quando existe', () => {
    const doc = {
      getFlag: vi.fn((scope, key) => (scope === MODULE_ID && key === 'draftId' ? 'novo' : undefined)),
      flags: { [LEGACY_MODULE_ID]: { draftId: 'antigo' } },
    };
    expect(readFlag(doc, 'draftId')).toBe('novo');
  });

  it('cai pro escopo legado (propriedade crua) quando o novo está vazio', () => {
    const doc = {
      getFlag: vi.fn(() => undefined),
      flags: { [LEGACY_MODULE_ID]: { sourceId: 'id-do-site' } },
    };
    expect(readFlag(doc, 'sourceId')).toBe('id-do-site');
  });

  it('NUNCA chama getFlag com o escopo legado (o Foundry lança erro: módulo inativo)', () => {
    const getFlag = vi.fn((scope) => {
      if (scope === LEGACY_MODULE_ID) throw new Error('Flag scope is not valid or not currently active');
      return undefined;
    });
    const doc = { getFlag, flags: { [LEGACY_MODULE_ID]: { rollId: 'r1' } } };
    expect(() => readFlag(doc, 'rollId')).not.toThrow();
    expect(readFlag(doc, 'rollId')).toBe('r1');
    expect(getFlag).not.toHaveBeenCalledWith(LEGACY_MODULE_ID, expect.anything());
  });

  it('devolve undefined sem flag em nenhum escopo, e aceita documento nulo', () => {
    expect(readFlag({ getFlag: () => undefined, flags: {} }, 'x')).toBeUndefined();
    expect(readFlag(null, 'x')).toBeUndefined();
    expect(readFlag({ flags: {} }, 'x')).toBeUndefined();
  });
});

describe('clearFlag', () => {
  it('limpa o escopo novo e remove o legado quando ele existe', async () => {
    const doc = {
      unsetFlag: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      flags: { [LEGACY_MODULE_ID]: { draftId: 'antigo' } },
    };
    await clearFlag(doc, 'draftId');
    expect(doc.unsetFlag).toHaveBeenCalledWith(MODULE_ID, 'draftId');
    expect(doc.update).toHaveBeenCalledWith({ [`flags.${LEGACY_MODULE_ID}.-=draftId`]: null });
  });

  it('não faz update se não há flag legado', async () => {
    const doc = { unsetFlag: vi.fn(async () => {}), update: vi.fn(async () => {}), flags: {} };
    await clearFlag(doc, 'draftId');
    expect(doc.update).not.toHaveBeenCalled();
  });
});

describe('flags.runarcana-sync muda para o id atual', () => {
  it('copia sourceId pro escopo novo e apaga o antigo no objeto', () => {
    const item = {
      flags: {
        [LEGACY_MODULE_ID]: { sourceId: 'site-1', catalogKey: 'espada' },
        dnd5e: { advancementOrigin: 'clericClass0000.adv' },
      },
    };
    adoptLegacyModuleFlags(item);
    expect(item.flags[MODULE_ID]).toEqual({ sourceId: 'site-1', catalogKey: 'espada' });
    expect(item.flags[LEGACY_MODULE_ID]).toBeUndefined();
    expect(item.flags.dnd5e.advancementOrigin).toBe('clericClass0000.adv');
  });

  it('não cobre valor que o escopo novo já tem', () => {
    const item = {
      flags: {
        [MODULE_ID]: { sourceId: 'novo' },
        [LEGACY_MODULE_ID]: { sourceId: 'velho', catalogKey: 'k' },
      },
    };
    adoptLegacyModuleFlags(item);
    expect(item.flags[MODULE_ID]).toEqual({ sourceId: 'novo', catalogKey: 'k' });
    expect(item.flags).not.toHaveProperty(LEGACY_MODULE_ID);
  });

  it('o update do Ator apaga o escopo antigo e preenche o novo', () => {
    const doc = {
      getFlag: () => undefined,
      flags: { [LEGACY_MODULE_ID]: { sourceId: 'site-1' } },
    };
    expect(legacyModuleFlagDeletions(doc)).toEqual({
      [`flags.${LEGACY_MODULE_ID}.-=sourceId`]: null,
      [`flags.${MODULE_ID}.sourceId`]: 'site-1',
    });
  });

  it('sem flag antiga não há update', () => {
    expect(legacyModuleFlagDeletions({ flags: { [MODULE_ID]: { sourceId: 'site-1' } } })).toBeNull();
    expect(legacyModuleFlagDeletions(null)).toBeNull();
  });
});
