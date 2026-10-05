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
      attributes: { hp: { max: 12, value: 12, temp: 0 }, movement: { walk: 30, units: 'ft' } },
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

describe('SyncManager._applyRemoteDraft — deslocamento é Foundry -> site só (FDD-47)', () => {
  it('não escreve system.attributes.movement.walk de volta no Ator mesmo com um valor diferente no draft remoto', async () => {
    const actor = makeActor();
    const manager = new SyncManager({});

    // identity.movementSpeed pode vir de uma edição manual antiga do builder
    // (personagem sem Ator vinculado) — não deve sobrescrever o walk que o
    // dnd5e já calculou (raça + efeito ativo + item), mesma regra do hp.max.
    await manager._applyRemoteDraft(actor, { identity: { movementSpeed: 25 } });

    expect(actor.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ 'system.attributes.movement.walk': expect.anything() }),
    );
  });
});

describe('SyncManager — nome do personagem sincroniza nos dois sentidos', () => {
  it('site -> Foundry: renomeia o Ator pro concept.name da ficha', async () => {
    const actor = makeActor();
    actor.name = 'Personagem';
    const manager = new SyncManager({});

    await manager._applyRemoteDraft(actor, { concept: { name: 'Karon' } });

    expect(actor.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'Karon' }));
  });

  it('site -> Foundry: nome em branco na ficha nunca vira nome do Ator', async () => {
    const actor = makeActor();
    actor.name = 'Personagem';
    const manager = new SyncManager({});

    await manager._applyRemoteDraft(actor, { concept: { name: '   ' } });

    const updates = actor.update.mock.calls.map((call) => call[0]);
    expect(updates.some((update) => 'name' in update)).toBe(false);
  });

  it('site -> Foundry: não reescreve o nome quando já é igual', async () => {
    const actor = makeActor();
    actor.name = 'Karon';
    const manager = new SyncManager({});

    await manager._applyRemoteDraft(actor, { concept: { name: 'Karon' } });

    const updates = actor.update.mock.calls.map((call) => call[0]);
    expect(updates.some((update) => 'name' in update)).toBe(false);
  });

  it('Foundry -> site: o overlay do Ator grava o nome atual em concept.name', () => {
    const actor = makeActor();
    actor.name = 'Karon Renomeado';
    actor.img = '';
    actor.classes = {};
    actor.items = [];
    const manager = new SyncManager({});
    const base = { concept: { name: 'Karon', portraitUrl: 'x' }, identity: {} };

    manager._overlayActorOntoDraft(actor, base);

    expect(base.concept.name).toBe('Karon Renomeado');
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

describe('SyncManager — PUTs do mesmo Ator em fila (FDD-36)', () => {
  function makeSyncActor() {
    const actor = makeActor();
    actor.name = 'Lyra';
    actor.img = '';
    actor.classes = {};
    actor.items = [];
    return actor;
  }

  it('o PUT de itens parte do draft que o PUT do Ator acabou de salvar, sem rodar em paralelo', async () => {
    const actor = makeSyncActor();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const bases = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const apiClient = {
      saveDraft: vi.fn(async (_id, payload) => {
        bases.push(payload.updatedAt);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (bases.length === 1) await gate;
        inFlight -= 1;
        return { ...payload, updatedAt: `t${bases.length}` };
      }),
    };
    const manager = new SyncManager(apiClient);
    manager.lastKnownDraft.set(actor.id, { id: 'draft-1', updatedAt: 't0', concept: { name: 'Lyra' } });

    const first = manager._executeActorUpdate(actor, 'draft-1');
    const second = manager._executeItemUpdate(actor, 'draft-1');
    await Promise.resolve();
    release();
    await Promise.all([first, second]);

    expect(maxInFlight).toBe(1);
    expect(bases).toEqual(['t0', 't1']);
    expect(manager.lastKnownDraft.get(actor.id).updatedAt).toBe('t2');
  });

  it('um PUT que falha não trava a fila: o próximo ainda roda', async () => {
    const actor = makeSyncActor();
    const apiClient = {
      saveDraft: vi.fn()
        .mockRejectedValueOnce(new Error('rede'))
        .mockResolvedValueOnce({ id: 'draft-1', updatedAt: 't1' }),
    };
    const manager = new SyncManager(apiClient);
    manager.lastKnownDraft.set(actor.id, { id: 'draft-1', updatedAt: 't0' });

    const first = manager._executeActorUpdate(actor, 'draft-1');
    const second = manager._executeItemUpdate(actor, 'draft-1');

    await expect(first).rejects.toThrow('rede');
    await expect(second).resolves.toBeUndefined();
    expect(apiClient.saveDraft).toHaveBeenCalledTimes(2);
  });
});

describe('SyncManager.startListening — evento roll', () => {
  it('não trata payload de roll como atualização de ficha', async () => {
    global.game = { user: { isGM: true }, messages: { contents: [] } };
    global.ChatMessage = {
      getSpeaker: vi.fn(() => ({ alias: 'Karon' })),
      create: vi.fn(async () => ({})),
    };

    const actor = {
      ...makeActor(),
      name: 'Karon',
      getFlag: () => 'draft-1',
    };
    let onMessage;
    const initialDraft = { id: 'draft-1', derivedStats: { currentHp: 12 } };
    const apiClient = {
      clientId: 'foundry-client',
      getDraft: vi.fn().mockResolvedValue(initialDraft),
      openStream: vi.fn(async (_id, handler) => {
        onMessage = handler;
        return { close: vi.fn() };
      }),
    };
    const manager = new SyncManager(apiClient);
    manager._applyRemoteDraft = vi.fn();
    manager._executeActorUpdate = vi.fn();
    manager._executeItemUpdate = vi.fn();

    await manager.startListening(actor);
    expect(manager.lastKnownDraft.get('actor-1')).toEqual(initialDraft);

    await onMessage({
      draftId: 'draft-1',
      roll: { id: 'roll-1', kind: 'damage', label: 'Chama Sagrada (dano)', total: 5, dice: [5] },
      sourceClientId: 'site',
    });

    expect(manager.lastKnownDraft.get('actor-1')).toEqual(initialDraft);
    expect(manager._applyRemoteDraft).toHaveBeenCalledTimes(1);
    expect(ChatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: { 'arthinfo-fichas-sync': { rollId: 'roll-1', kind: 'damage' } },
      }),
    );
  });
});

describe('SyncManager.startListening — evento item-equip', () => {
  it('não trata payload de item-equip como atualização de ficha, aplica no item do Ator', async () => {
    global.game = { user: { id: 'gm-1' }, users: { activeGM: { id: 'gm-1' } } };

    const weapon = {
      id: 'weapon-1',
      system: { equipped: false },
      getFlag: vi.fn(() => undefined),
      update: vi.fn(async () => ({})),
    };
    const actor = {
      ...makeActor(),
      name: 'Karon',
      items: [weapon],
      getFlag: () => 'draft-1',
    };
    let onMessage;
    const initialDraft = { id: 'draft-1', derivedStats: { currentHp: 12 } };
    const apiClient = {
      clientId: 'foundry-client',
      getDraft: vi.fn().mockResolvedValue(initialDraft),
      openStream: vi.fn(async (_id, handler) => {
        onMessage = handler;
        return { close: vi.fn() };
      }),
    };
    const manager = new SyncManager(apiClient);
    manager._applyRemoteDraft = vi.fn();
    manager._executeActorUpdate = vi.fn();
    manager._executeItemUpdate = vi.fn();

    await manager.startListening(actor);

    await onMessage({
      draftId: 'draft-1',
      itemEquip: { itemId: 'weapon-1', equipped: true },
      sourceClientId: 'site',
    });

    expect(weapon.update).toHaveBeenCalledWith({ 'system.equipped': true });
    // _applyRemoteDraft já foi chamado 1x no startListening (aplica o draft
    // inicial) — a mensagem item-equip não deve gerar uma 2ª chamada, ela
    // não é uma atualização de ficha.
    expect(manager._applyRemoteDraft).toHaveBeenCalledTimes(1);
  });
});

describe('SyncManager.startListening — evento item-cast', () => {
  it('não trata payload de item-cast como atualização de ficha, aplica no item/Ator', async () => {
    global.game = { user: { id: 'gm-1' }, users: { activeGM: { id: 'gm-1' } } };

    const spell = {
      id: 'spell-1',
      name: 'Armadura de Mago',
      system: { uses: { spent: 0, max: 1 } },
      getFlag: vi.fn(() => undefined),
      update: vi.fn(async () => ({})),
    };
    const actor = {
      ...makeActor(),
      name: 'Karon',
      items: [spell],
      system: { ...makeActor().system, spells: { spell1: { value: 2, max: 4 } } },
      getFlag: () => 'draft-1',
    };
    let onMessage;
    const initialDraft = { id: 'draft-1', derivedStats: { currentHp: 12 } };
    const apiClient = {
      clientId: 'foundry-client',
      getDraft: vi.fn().mockResolvedValue(initialDraft),
      openStream: vi.fn(async (_id, handler) => {
        onMessage = handler;
        return { close: vi.fn() };
      }),
    };
    const manager = new SyncManager(apiClient);
    manager._applyRemoteDraft = vi.fn();
    manager._executeActorUpdate = vi.fn();
    manager._executeItemUpdate = vi.fn();

    await manager.startListening(actor);

    await onMessage({
      draftId: 'draft-1',
      itemCast: { itemId: 'spell-1', using: 'slot', slotLevel: 1 },
      sourceClientId: 'site',
    });

    expect(actor.update).toHaveBeenCalledWith({ 'system.spells.spell1.value': 1 });
    expect(manager._applyRemoteDraft).toHaveBeenCalledTimes(1);
  });
});
