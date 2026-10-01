import { describe, expect, it, vi } from 'vitest';
import { LEGACY_MODULE_ID, MODULE_ID } from './module-id.js';
import {
  migrateLegacyActorLinks,
  migrateLegacySettings,
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
      current: { mesaKey: '', backendUrl: 'https://api.runarcana.org' },
    });
    expect(await migrateLegacySettings(game)).toBe(2);
    expect(game.settings.set).toHaveBeenCalledWith(MODULE_ID, 'mesaKey', 'ra_mesa_abc');
    // o padrão do módulo conta como "não configurado": a URL personalizada migra
    expect(game.settings.set).toHaveBeenCalledWith(MODULE_ID, 'backendUrl', 'https://meu.backend');
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
    expect(await runLegacyMigration(game)).toEqual({ settings: 1, links: 1 });
    log.mockRestore();
  });
});
