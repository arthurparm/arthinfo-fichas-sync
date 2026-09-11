import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncManager } from './sync-manager.js';

function getProperty(object, path) {
  return path.split('.').reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), object);
}

function setProperty(object, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((current, key) => {
    if (current[key] === undefined) current[key] = {};
    return current[key];
  }, object);
  target[last] = value;
  return object;
}

beforeEach(() => {
  global.foundry = {
    utils: {
      getProperty,
      setProperty,
      deepClone: (value) => JSON.parse(JSON.stringify(value)),
    },
  };
  global.ui = { notifications: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } };
});

function makeActor() {
  return {
    id: 'actor-1',
    system: {
      abilities: {
        str: { value: 10, proficient: 0 },
        dex: { value: 10, proficient: 0 },
        con: { value: 10, proficient: 0 },
        int: { value: 10, proficient: 0 },
        wis: { value: 10, proficient: 0 },
        cha: { value: 10, proficient: 0 },
      },
      attributes: { hp: { max: 12, value: 12, temp: 0 } },
      skills: {},
    },
    update: vi.fn(async () => undefined),
  };
}

describe('SyncManager._applyRemoteDraft — hp.max é Foundry -> site só (não corrige de volta)', () => {
  it('não escreve system.attributes.hp.max de volta no Ator mesmo quando o draft remoto traz um valor diferente', async () => {
    const actor = makeActor();
    const manager = new SyncManager({});

    // Site calculou (errado ou não) um maxHp diferente do que o Ator já tem
    // — não deve viajar de volta pro Foundry, que é quem manda nesse valor.
    await manager._applyRemoteDraft(actor, { derivedStats: { maxHp: 2, currentHp: 12 } });

    expect(actor.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ 'system.attributes.hp.max': expect.anything() }),
    );
  });

  it('continua escrevendo hp.value (dano sofrido) e hp.temp de volta no Ator normalmente', async () => {
    const actor = makeActor();
    const manager = new SyncManager({});

    await manager._applyRemoteDraft(actor, { derivedStats: { currentHp: 5, tempHp: 3 } });

    expect(actor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        'system.attributes.hp.value': 5,
        'system.attributes.hp.temp': 3,
      }),
    );
    const updateCall = actor.update.mock.calls[0][0];
    expect(updateCall).not.toHaveProperty('system.attributes.hp.max');
  });
});

describe('SyncManager._executeActorUpdate — If-Match / 409 (FDD-35)', () => {
  function conflict(current) {
    return Object.assign(new Error('Ficha foi modificada por outra origem desde a última leitura.'), {
      status: 409,
      current,
    });
  }

  it('manda o updatedAt da última cópia conhecida e reaplica HP do Ator em cima do draft do 409', async () => {
    const actor = makeActor();
    actor.name = 'Lyra';
    actor.img = '';
    actor.system.attributes.hp.value = 7;

    const stale = {
      id: 'draft-1',
      updatedAt: '2026-01-01T10:00:00.000Z',
      concept: { name: 'Lyra' },
      derivedStats: { currentHp: 12, maxHp: 12 },
    };
    const fromSite = {
      id: 'draft-1',
      updatedAt: '2026-01-01T10:05:00.000Z',
      concept: { name: 'Lyra' },
      proficiencies: { skills: { athletics: true } },
      derivedStats: { currentHp: 12, maxHp: 12 },
    };
    const saved = {
      ...fromSite,
      updatedAt: '2026-01-01T10:06:00.000Z',
      derivedStats: { currentHp: 7, maxHp: 12 },
    };

    const apiClient = {
      saveDraft: vi.fn().mockRejectedValueOnce(conflict(fromSite)).mockResolvedValueOnce(saved),
    };
    const manager = new SyncManager(apiClient);
    manager.lastKnownDraft.set(actor.id, stale);

    await manager._executeActorUpdate(actor, 'draft-1');

    expect(apiClient.saveDraft).toHaveBeenCalledTimes(2);
    expect(apiClient.saveDraft.mock.calls[0][1].updatedAt).toBe('2026-01-01T10:00:00.000Z');
    const retryPayload = apiClient.saveDraft.mock.calls[1][1];
    expect(retryPayload.updatedAt).toBe('2026-01-01T10:05:00.000Z');
    expect(retryPayload.proficiencies.skills.athletics).toBe(true);
    expect(retryPayload.derivedStats.currentHp).toBe(7);
    expect(manager.lastKnownDraft.get(actor.id)).toEqual(saved);
    expect(ui.notifications.error).not.toHaveBeenCalled();
  });

  it('não tenta de novo sem current no 409 — avisa e relança', async () => {
    const actor = makeActor();
    actor.name = 'Lyra';
    actor.img = '';
    const apiClient = {
      saveDraft: vi.fn().mockRejectedValueOnce(conflict(null)),
    };
    const manager = new SyncManager(apiClient);
    manager.lastKnownDraft.set(actor.id, {
      id: 'draft-1',
      updatedAt: '2026-01-01T10:00:00.000Z',
      derivedStats: { currentHp: 12 },
    });

    await expect(manager._executeActorUpdate(actor, 'draft-1')).rejects.toMatchObject({ status: 409 });
    expect(apiClient.saveDraft).toHaveBeenCalledTimes(1);
    expect(ui.notifications.error).toHaveBeenCalled();
  });
});
