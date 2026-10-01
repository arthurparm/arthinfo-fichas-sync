import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applySpellSlot } from './apply-spell-slot.js';

function makeActor() {
  return {
    name: 'Karon',
    system: {
      spells: {
        spell1: { value: 2, max: 4 },
        spell3: { value: 1, max: 3 },
        pact: { value: 0, max: 2 },
      },
    },
    update: vi.fn(async () => ({})),
  };
}

describe('applySpellSlot', () => {
  beforeEach(() => {
    global.game = { user: { id: 'gm-1' }, users: { activeGM: { id: 'gm-1' } } };
  });

  it('grava o valor absoluto no círculo pedido', async () => {
    const actor = makeActor();
    await applySpellSlot(actor, { level: 3, value: 3 });
    expect(actor.update).toHaveBeenCalledWith({ 'system.spells.spell3.value': 3 });
  });

  it('limita ao máximo do Ator', async () => {
    const actor = makeActor();
    await applySpellSlot(actor, { level: 1, value: 50 });
    expect(actor.update).toHaveBeenCalledWith({ 'system.spells.spell1.value': 4 });
  });

  it('slots de pacto', async () => {
    const actor = makeActor();
    await applySpellSlot(actor, { level: 'pact', value: 2 });
    expect(actor.update).toHaveBeenCalledWith({ 'system.spells.pact.value': 2 });
  });

  it('não escreve quando o valor já é o atual', async () => {
    const actor = makeActor();
    await applySpellSlot(actor, { level: 1, value: 2 });
    expect(actor.update).not.toHaveBeenCalled();
  });

  it('ignora círculo inexistente, valor inválido e cliente que não é o GM ativo', async () => {
    const actor = makeActor();
    await applySpellSlot(actor, { level: 9, value: 1 });
    await applySpellSlot(actor, { level: 1, value: -1 });
    await applySpellSlot(actor, { level: 1, value: 'x' });
    global.game = { user: { id: 'gm-2' }, users: { activeGM: { id: 'gm-1' } } };
    await applySpellSlot(actor, { level: 1, value: 1 });
    expect(actor.update).not.toHaveBeenCalled();
  });
});
