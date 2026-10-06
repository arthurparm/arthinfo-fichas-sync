import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  actorHasNoMaxHp,
  buildHitPointsUpdate,
  findHitPoints,
  repairClassHitPoints,
  startAtFullHitPoints,
} from './class-hit-points.js';

beforeEach(() => {
  global.foundry = { utils: { randomID: vi.fn(() => 'newId0000000000a') } };
});

const wizard = (advancement) => ({ type: 'class', name: 'Mago', system: { levels: 1, advancement } });

describe('buildHitPointsUpdate', () => {
  it('classe sem avanço nenhum (Ator de versão antiga): cria o avanço de PV com o 1º nível no máximo', () => {
    const update = buildHitPointsUpdate(wizard(undefined), () => 'abc');
    expect(update).toEqual({
      'system.advancement.abc': {
        _id: 'abc',
        type: 'HitPoints',
        configuration: {},
        value: { 1: 'max' },
        flags: {},
        hint: '',
      },
    });
  });

  it('avanço de PV existente sem valor: só preenche o 1º nível, sem tocar nos outros avanços', () => {
    const update = buildHitPointsUpdate(
      wizard({ hp1: { _id: 'hp1', type: 'HitPoints', value: {} }, tr1: { _id: 'tr1', type: 'Trait' } }),
      () => 'abc',
    );
    expect(update).toEqual({ 'system.advancement.hp1.value.1': 'max' });
  });

  it('formato em lista: devolve a lista inteira com o avanço de PV ajustado', () => {
    const list = [
      { _id: 'tr1', type: 'Trait' },
      { _id: 'hp1', type: 'HitPoints', value: {} },
    ];
    const update = buildHitPointsUpdate(wizard(list), () => 'abc');
    expect(update['system.advancement']).toEqual([
      { _id: 'tr1', type: 'Trait' },
      { _id: 'hp1', type: 'HitPoints', value: { 1: 'max' } },
    ]);
  });

  it('formato em lista sem avanço de PV: acrescenta ao fim', () => {
    const update = buildHitPointsUpdate(wizard([{ _id: 'tr1', type: 'Trait' }]), () => 'abc');
    expect(update['system.advancement']).toHaveLength(2);
    expect(update['system.advancement'][1].type).toBe('HitPoints');
  });

  it('não mexe quando o 1º nível já tem valor (nem quando é "avg" ou número)', () => {
    expect(buildHitPointsUpdate(wizard({ hp1: { type: 'HitPoints', value: { 1: 'max' } } }), () => 'x')).toBeNull();
    expect(buildHitPointsUpdate(wizard({ hp1: { type: 'HitPoints', value: { 1: 4 } } }), () => 'x')).toBeNull();
  });

  it('ignora o que não é classe ou ainda não tem nível', () => {
    expect(buildHitPointsUpdate({ type: 'feat', system: {} }, () => 'x')).toBeNull();
    expect(buildHitPointsUpdate({ type: 'class', system: { levels: 0 } }, () => 'x')).toBeNull();
    expect(buildHitPointsUpdate(null, () => 'x')).toBeNull();
  });
});

describe('findHitPoints', () => {
  it('acha o avanço de PV nos dois formatos', () => {
    expect(findHitPoints({ a: { type: 'Trait' }, b: { type: 'HitPoints' } })?.id).toBe('b');
    expect(findHitPoints([{ _id: 'z', type: 'HitPoints' }])?.id).toBe('z');
    expect(findHitPoints(undefined)).toBeNull();
  });
});

describe('repairClassHitPoints', () => {
  function makeActor({ max = 0, value = 0, classData = wizard(undefined) } = {}) {
    const classItem = {
      type: 'class',
      toObject: () => classData,
      update: vi.fn(async () => {
        // O dnd5e recalcula hp.max assim que o avanço entra.
        actor.system.attributes.hp.max = 7;
      }),
    };
    const actor = {
      system: { attributes: { hp: { max, value } } },
      items: { contents: [classItem, { type: 'feat', toObject: () => ({ type: 'feat' }), update: vi.fn() }] },
      update: vi.fn(async () => undefined),
    };
    return { actor, classItem };
  }

  it('grava o avanço de PV na classe sem avanço e só nela', async () => {
    const { actor, classItem } = makeActor();

    expect(await repairClassHitPoints(actor)).toBe(1);

    expect(classItem.update).toHaveBeenCalledOnce();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it('classe já correta: não faz nada', async () => {
    const { actor, classItem } = makeActor({
      max: 7,
      value: 7,
      classData: wizard({ hp1: { type: 'HitPoints', value: { 1: 'max' } } }),
    });

    expect(await repairClassHitPoints(actor)).toBe(0);
    expect(classItem.update).not.toHaveBeenCalled();
  });
});

describe('startAtFullHitPoints', () => {
  const actorWith = (max, value) => ({
    system: { attributes: { hp: { max, value } } },
    update: vi.fn(async () => undefined),
  });

  it('Ator que ganhou PV máximo agora (e estava sem vida) começa cheio', async () => {
    const actor = actorWith(5, 0);
    expect(await startAtFullHitPoints(actor, true)).toBe(true);
    expect(actor.update).toHaveBeenCalledWith({ 'system.attributes.hp.value': 5 });
  });

  it('Ator que já tinha PV máximo antes não é curado', async () => {
    const actor = actorWith(12, 0);
    expect(await startAtFullHitPoints(actor, false)).toBe(false);
    expect(actor.update).not.toHaveBeenCalled();
  });

  it('quem já tem vida atual não é mexido', async () => {
    const actor = actorWith(5, 3);
    expect(await startAtFullHitPoints(actor, true)).toBe(false);
    expect(actor.update).not.toHaveBeenCalled();
  });

  it('continua sem PV máximo: não escreve nada', async () => {
    const actor = actorWith(0, 0);
    expect(await startAtFullHitPoints(actor, true)).toBe(false);
    expect(actor.update).not.toHaveBeenCalled();
  });
});

describe('actorHasNoMaxHp', () => {
  it('detecta Ator sem PV máximo', () => {
    expect(actorHasNoMaxHp({ system: { attributes: { hp: { max: 0 } } } })).toBe(true);
    expect(actorHasNoMaxHp({ system: { attributes: { hp: { max: 7 } } } })).toBe(false);
    expect(actorHasNoMaxHp({})).toBe(true);
  });
});
