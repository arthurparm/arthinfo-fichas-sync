import { describe, expect, it, vi } from 'vitest';
import { LEGACY_MODULE_ID, MODULE_ID } from './module-id.js';
import {
  migrateLegacyActorLinks,
  migrateLegacyItemFlags,
  migrateLegacySettings,
  purgeRemovedSettings,
  runLegacyMigration,
} from './legacy-migration.js';

function makeActor({ name = 'Karon', legacyDraftId, newDraftId } = {}) {
  const actor = {
    name,
    flags: legacyDraftId ? { [LEGACY_MODULE_ID]: { draftId: legacyDraftId } } : {},
    getFlag: vi.fn((scope, key) => (scope === MODULE_ID && key === 'draftId' ? newDraftId : undefined)),
    update: vi.fn(async () => {}),
  };
  return actor;
}

function makeGame({ isGM = true, actors = [], legacySettings = {}, current = {} } = {}) {
  const world = {
    getSetting: (fullKey) => {
      const key = fullKey.replace(`${LEGACY_MODULE_ID}.`, '');
      return key in legacySettings ? { key: fullKey, value: legacySettings[key] } : undefined;
    },
  };
  const values = { ...current };
  return {
    user: { isGM },
    actors,
    settings: {
      storage: { get: vi.fn(() => world) },
      get: vi.fn((scope, key) => values[key]),
      set: vi.fn(async (scope, key, value) => {
        values[key] = value;
      }),
    },
  };
}

describe('migrateLegacyActorLinks', () => {
  it('copia o vínculo antigo pro escopo novo e remove o antigo', async () => {
    const actor = makeActor({ legacyDraftId: 'ficha-1' });
    const migrated = await migrateLegacyActorLinks(makeGame({ actors: [actor] }));
    expect(migrated).toBe(1);
    expect(actor.update).toHaveBeenCalledWith({
      [`flags.${LEGACY_MODULE_ID}.-=draftId`]: null,
      [`flags.${MODULE_ID}.draftId`]: 'ficha-1',
    });
  });

  it('não sobrescreve um vínculo que já existe no escopo novo (só limpa o antigo)', async () => {
    const actor = makeActor({ legacyDraftId: 'ficha-velha', newDraftId: 'ficha-nova' });
    await migrateLegacyActorLinks(makeGame({ actors: [actor] }));
    expect(actor.update).toHaveBeenCalledWith({ [`flags.${LEGACY_MODULE_ID}.-=draftId`]: null });
  });

  it('ignora Atores sem vínculo antigo', async () => {
    const actor = makeActor();
    expect(await migrateLegacyActorLinks(makeGame({ actors: [actor] }))).toBe(0);
    expect(actor.update).not.toHaveBeenCalled();
  });

  it('só o GM migra', async () => {
    const actor = makeActor({ legacyDraftId: 'ficha-1' });
    expect(await migrateLegacyActorLinks(makeGame({ isGM: false, actors: [actor] }))).toBe(0);
    expect(actor.update).not.toHaveBeenCalled();
  });

  it('um Ator que falha não impede os outros', async () => {
    const ruim = makeActor({ name: 'Ruim', legacyDraftId: 'a' });
    ruim.update.mockRejectedValue(new Error('sem permissão'));
    const bom = makeActor({ name: 'Bom', legacyDraftId: 'b' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const migrated = await migrateLegacyActorLinks(makeGame({ actors: [ruim, bom] }));
    expect(migrated).toBe(1);
    expect(bom.update).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('migrateLegacySettings', () => {
  it('copia a configuração antiga quando a nova está vazia', async () => {
    const game = makeGame({
      legacySettings: { mesaKey: 'ra_mesa_abc', backendUrl: 'https://meu.backend' },
      current: { mesaKey: '' },
    });
    expect(await migrateLegacySettings(game)).toBe(1);
    expect(game.settings.set).toHaveBeenCalledWith(MODULE_ID, 'mesaKey', 'ra_mesa_abc');
    // a URL do backend vai embutida no build (FDD-73): nunca migra
    expect(game.settings.set).not.toHaveBeenCalledWith(MODULE_ID, 'backendUrl', expect.anything());
  });

  it('não sobrescreve uma configuração que o usuário já preencheu no módulo novo', async () => {
    const game = makeGame({
      legacySettings: { mesaKey: 'antiga' },
      current: { mesaKey: 'ra_mesa_nova' },
    });
    expect(await migrateLegacySettings(game)).toBe(0);
    expect(game.settings.set).not.toHaveBeenCalled();
  });

  it('interpreta valor gravado como JSON (ex.: lista de compêndios)', async () => {
    const game = makeGame({
      legacySettings: { compendiumSyncSelection: JSON.stringify(['world.itens']) },
      current: { compendiumSyncSelection: [] },
    });
    await migrateLegacySettings(game);
    expect(game.settings.set).toHaveBeenCalledWith(MODULE_ID, 'compendiumSyncSelection', ['world.itens']);
  });

  it('sem configuração antiga, não faz nada; e só o GM migra', async () => {
    expect(await migrateLegacySettings(makeGame())).toBe(0);
    const game = makeGame({ isGM: false, legacySettings: { mesaKey: 'x' }, current: { mesaKey: '' } });
    expect(await migrateLegacySettings(game)).toBe(0);
    expect(game.settings.set).not.toHaveBeenCalled();
  });
});

describe('runLegacyMigration', () => {
  it('roda as duas migrações e devolve os totais', async () => {
    const actor = makeActor({ legacyDraftId: 'ficha-1' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const game = makeGame({
      actors: [actor],
      legacySettings: { mesaKey: 'k' },
      current: { mesaKey: '' },
    });
    expect(await runLegacyMigration(game)).toEqual({ settings: 1, links: 1, items: 0 });
    log.mockRestore();
  });
});

describe('purgeRemovedSettings (FDD-74)', () => {
  function makeStoreGame({ isGM = true, keys = [] } = {}) {
    const docs = new Map(keys.map((key) => [key, { key, value: 'segredo', delete: vi.fn(async () => {}) }]));
    return {
      docs,
      game: {
        user: { isGM },
        settings: { storage: { get: vi.fn(() => ({ getSetting: (key) => docs.get(key) })) } },
      },
    };
  }

  it('apaga a chave do id novo e do id legado', async () => {
    const { game, docs } = makeStoreGame({
      keys: [`${MODULE_ID}.compendiumSyncKey`, `${LEGACY_MODULE_ID}.compendiumSyncKey`],
    });
    expect(await purgeRemovedSettings(game)).toBe(2);
    for (const doc of docs.values()) expect(doc.delete).toHaveBeenCalledTimes(1);
  });

  it('apaga também a URL do backend salva, que prenderia o mundo numa URL velha (FDD-73)', async () => {
    const { game, docs } = makeStoreGame({
      keys: [`${MODULE_ID}.backendUrl`, `${LEGACY_MODULE_ID}.backendUrl`, `${MODULE_ID}.mesaKey`],
    });
    docs.get(`${MODULE_ID}.backendUrl`).value = 'http://localhost:3000';
    expect(await purgeRemovedSettings(game)).toBe(2);
    expect(docs.get(`${MODULE_ID}.mesaKey`).delete).not.toHaveBeenCalled();
  });

  it('sem chave guardada, não faz nada; só o GM apaga', async () => {
    expect(await purgeRemovedSettings(makeStoreGame().game)).toBe(0);
    const { game, docs } = makeStoreGame({ isGM: false, keys: [`${MODULE_ID}.compendiumSyncKey`] });
    expect(await purgeRemovedSettings(game)).toBe(0);
    expect([...docs.values()][0].delete).not.toHaveBeenCalled();
  });

  it('falha ao apagar uma não impede a outra', async () => {
    const { game, docs } = makeStoreGame({
      keys: [`${MODULE_ID}.compendiumSyncKey`, `${LEGACY_MODULE_ID}.compendiumSyncKey`],
    });
    [...docs.values()][0].delete.mockRejectedValueOnce(new Error('sem permissão'));
    expect(await purgeRemovedSettings(game)).toBe(1);
  });
});

describe('migrateLegacyItemFlags (FDD-70)', () => {
  function makeItemActor(items, name = 'Karon') {
    return { name, items, updateEmbeddedDocuments: vi.fn(async () => {}) };
  }
  const legacyItem = (id, flags) => ({ id, flags });

  it('move sourceId e catalogKey do id antigo pro novo, em um lote por Ator', async () => {
    const actor = makeItemActor([
      legacyItem('a', { [LEGACY_MODULE_ID]: { sourceId: 'site-a', catalogKey: 'k1' } }),
      legacyItem('b', { [LEGACY_MODULE_ID]: { sourceId: 'site-b' } }),
    ]);
    expect(await migrateLegacyItemFlags({ user: { isGM: true }, actors: [actor] })).toBe(2);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith('Item', [
      {
        _id: 'a',
        [`flags.${LEGACY_MODULE_ID}.-=sourceId`]: null,
        [`flags.${MODULE_ID}.sourceId`]: 'site-a',
        [`flags.${LEGACY_MODULE_ID}.-=catalogKey`]: null,
        [`flags.${MODULE_ID}.catalogKey`]: 'k1',
      },
      {
        _id: 'b',
        [`flags.${LEGACY_MODULE_ID}.-=sourceId`]: null,
        [`flags.${MODULE_ID}.sourceId`]: 'site-b',
      },
    ]);
  });

  it('não sobrescreve o flag novo; só limpa o antigo', async () => {
    const actor = makeItemActor([
      legacyItem('a', {
        [LEGACY_MODULE_ID]: { sourceId: 'velho' },
        [MODULE_ID]: { sourceId: 'novo' },
      }),
    ]);
    await migrateLegacyItemFlags({ user: { isGM: true }, actors: [actor] });
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith('Item', [
      { _id: 'a', [`flags.${LEGACY_MODULE_ID}.-=sourceId`]: null },
    ]);
  });

  it('é idempotente: item já migrado ou sem flag não gera update', async () => {
    const actor = makeItemActor([
      legacyItem('a', { [MODULE_ID]: { sourceId: 'x' } }),
      legacyItem('b', {}),
    ]);
    expect(await migrateLegacyItemFlags({ user: { isGM: true }, actors: [actor] })).toBe(0);
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it('só o GM migra; Ator que falha não impede os outros', async () => {
    const item = () => legacyItem('a', { [LEGACY_MODULE_ID]: { sourceId: 's' } });
    const ruim = makeItemActor([item()], 'Ruim');
    ruim.updateEmbeddedDocuments.mockRejectedValue(new Error('sem permissão'));
    const bom = makeItemActor([item()], 'Bom');
    expect(await migrateLegacyItemFlags({ user: { isGM: false }, actors: [bom] })).toBe(0);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await migrateLegacyItemFlags({ user: { isGM: true }, actors: [ruim, bom] })).toBe(1);
    warn.mockRestore();
  });
});

describe('migrateLegacyItemFlags no Foundry v14 (FDD-70)', () => {
  it('usa ForcedDeletion em vez da chave "-=" depreciada', async () => {
    class ForcedDeletion {}
    vi.stubGlobal('foundry', { data: { operators: { ForcedDeletion } } });
    const actor = {
      name: 'Daniel',
      items: [{ id: 'a', flags: { [LEGACY_MODULE_ID]: { sourceId: 's' } } }],
      updateEmbeddedDocuments: vi.fn(async () => {}),
    };
    await migrateLegacyItemFlags({ user: { isGM: true }, actors: [actor] });
    const [, [update]] = actor.updateEmbeddedDocuments.mock.calls[0];
    expect(update[`flags.${LEGACY_MODULE_ID}.sourceId`]).toBeInstanceOf(ForcedDeletion);
    expect(update[`flags.${MODULE_ID}.sourceId`]).toBe('s');
    expect(update).not.toHaveProperty(`flags.${LEGACY_MODULE_ID}.-=sourceId`);
    vi.unstubAllGlobals();
  });
});
