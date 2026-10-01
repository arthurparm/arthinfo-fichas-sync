import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyItemEquip } from './apply-item-equip.js';

function makeItem(overrides = {}) {
  return {
    id: 'item-1',
    system: { equipped: false },
    getFlag: vi.fn(() => undefined),
    update: vi.fn(async () => ({})),
    ...overrides,
  };
}

function makeActor(items, overrides = {}) {
  return {
    name: 'Karon',
    items,
    ...overrides,
  };
}

describe('applyItemEquip', () => {
  beforeEach(() => {
    global.game = { user: { id: 'gm-1' }, users: { activeGM: { id: 'gm-1' } } };
  });

  it('equipa o item achado pelo id real do Foundry (sem flag sourceId)', async () => {
    const item = makeItem({ id: 'item-1' });
    const actor = makeActor([item]);

    await applyItemEquip(actor, { itemId: 'item-1', equipped: true });

    expect(item.update).toHaveBeenCalledWith({ 'system.equipped': true });
  });

  it('resolve pelo flag sourceId quando o item nasceu do site (id do draft difere do _id do Foundry)', async () => {
    const item = makeItem({
      id: 'foundry-real-id',
      system: { equipped: true },
      getFlag: vi.fn((scope, key) => (scope === 'arthinfo-fichas-sync' && key === 'sourceId' ? 'draft-side-id' : undefined)),
    });
    const actor = makeActor([item]);

    await applyItemEquip(actor, { itemId: 'draft-side-id', equipped: false });

    expect(item.update).toHaveBeenCalledWith({ 'system.equipped': false });
  });

  it('não faz nada se o item já está no estado pedido (evita update/hook à toa)', async () => {
    const item = makeItem({ system: { equipped: true } });
    const actor = makeActor([item]);

    await applyItemEquip(actor, { itemId: 'item-1', equipped: true });

    expect(item.update).not.toHaveBeenCalled();
  });

  it('não faz nada se o item não existe no Ator', async () => {
    const item = makeItem({ id: 'other-item' });
    const actor = makeActor([item]);

    await applyItemEquip(actor, { itemId: 'missing-item', equipped: true });

    expect(item.update).not.toHaveBeenCalled();
  });

  it('não aplica nada se este cliente não é o GM ativo (evita (des)equipar em dobro com 2 GMs conectados)', async () => {
    game.users.activeGM = { id: 'gm-2' };
    const item = makeItem();
    const actor = makeActor([item]);

    await applyItemEquip(actor, { itemId: 'item-1', equipped: true });

    expect(item.update).not.toHaveBeenCalled();
  });

  it('ignora payload malformado (itemId/equipped ausentes ou com tipo errado)', async () => {
    const item = makeItem();
    const actor = makeActor([item]);

    await applyItemEquip(actor, {});
    await applyItemEquip(actor, { itemId: 'item-1' });
    await applyItemEquip(actor, { itemId: 'item-1', equipped: 'yes' });
    await applyItemEquip(actor, null);

    expect(item.update).not.toHaveBeenCalled();
  });

  it('ignora sem Ator', async () => {
    await expect(applyItemEquip(null, { itemId: 'item-1', equipped: true })).resolves.toBeUndefined();
  });
});
