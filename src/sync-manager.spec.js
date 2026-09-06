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
  global.foundry = { utils: { getProperty, setProperty } };
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
