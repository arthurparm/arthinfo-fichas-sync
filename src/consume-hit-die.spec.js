import { beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeSiteHitDieRoll } from './consume-hit-die.js';

function makeClass(overrides = {}) {
  return {
    system: { hd: { denomination: 'd12', value: 1, spent: 0, ...overrides.hd } },
    update: vi.fn(async () => ({})),
    ...overrides,
  };
}

// actor.system.attributes.hd.classes é uma Collection do Foundry de
// verdade (tem .find(), mas Array.isArray() nela dá false) — um array JS
// comum aqui deixaria passar um bug real que só aparece com a Collection
// de verdade (ver comentário em consume-hit-die.js).
function makeClassCollection(items) {
  return { find: (predicate) => items.find(predicate) };
}

function makeActor(overrides = {}) {
  const cls = overrides.classes ?? [makeClass()];
  return {
    system: {
      isNPC: false,
      attributes: {
        hd: { classes: makeClassCollection(cls) },
        hp: { value: 5, max: 10, effectiveMax: 10 },
      },
    },
    calculateDamage: vi.fn((parts) => ({ amount: parts[0].value })),
    update: vi.fn(async () => ({})),
    ...overrides,
  };
}

describe('consumeSiteHitDieRoll', () => {
  beforeEach(() => {
    global.game = { user: { id: 'gm-1', isGM: true }, users: { activeGM: { id: 'gm-1' } } };
  });

  it('ignora rolagens que não são dado de vida', async () => {
    const actor = makeActor();
    await consumeSiteHitDieRoll(actor, { kind: 'skill', dieSize: 20, total: 15 });
    expect(actor.update).not.toHaveBeenCalled();
  });

  it('não aplica nada se este cliente não é o GM ativo (evita descontar em dobro com 2 GMs conectados)', async () => {
    game.users.activeGM = { id: 'gm-2' };
    const actor = makeActor();
    await consumeSiteHitDieRoll(actor, { kind: 'hit-die', dieSize: 12, total: 9 });
    expect(actor.update).not.toHaveBeenCalled();
  });

  it('incrementa system.hd.spent da classe com o dado certo e cura o total rolado', async () => {
    const cls = makeClass();
    const actor = makeActor({ classes: [cls] });
    actor.system.attributes.hp = { value: 1, max: 20, effectiveMax: 20 };

    await consumeSiteHitDieRoll(actor, { kind: 'hit-die', dieSize: 12, total: 9 });

    expect(cls.update).toHaveBeenCalledWith({ 'system.hd.spent': 1 });
    expect(actor.update).toHaveBeenCalledWith({ 'system.attributes.hp.value': 10 });
  });

  it('não cura acima do effectiveMax', async () => {
    const cls = makeClass();
    const actor = makeActor({ classes: [cls] });
    actor.system.attributes.hp = { value: 8, max: 10, effectiveMax: 10 };

    await consumeSiteHitDieRoll(actor, { kind: 'hit-die', dieSize: 12, total: 9 });

    expect(actor.update).toHaveBeenCalledWith({ 'system.attributes.hp.value': 10 });
  });

  it('não chama actor.update de hp quando já está no máximo', async () => {
    const cls = makeClass();
    const actor = makeActor({ classes: [cls] });
    actor.system.attributes.hp = { value: 10, max: 10, effectiveMax: 10 };

    await consumeSiteHitDieRoll(actor, { kind: 'hit-die', dieSize: 12, total: 9 });

    expect(cls.update).toHaveBeenCalledWith({ 'system.hd.spent': 1 });
    expect(actor.update).not.toHaveBeenCalled();
  });

  it('não desconta se não há classe com esse dado disponível', async () => {
    const cls = makeClass({ hd: { denomination: 'd12', value: 0, spent: 1 } });
    const actor = makeActor({ classes: [cls] });

    await consumeSiteHitDieRoll(actor, { kind: 'hit-die', dieSize: 12, total: 9 });

    expect(cls.update).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it('personagem NPC usa system.attributes.hd.spent em vez de classe', async () => {
    const actor = makeActor({
      classes: [],
      system: {
        isNPC: true,
        attributes: {
          hd: { classes: [], value: 3, spent: 0 },
          hp: { value: 5, max: 20, effectiveMax: 20 },
        },
      },
    });

    await consumeSiteHitDieRoll(actor, { kind: 'hit-die', dieSize: 8, total: 6 });

    expect(actor.update).toHaveBeenCalledWith({
      'system.attributes.hd.spent': 1,
      'system.attributes.hp.value': 11,
    });
  });
});
