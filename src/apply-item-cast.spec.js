import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyItemCast } from './apply-item-cast.js';

function makeItem(overrides = {}) {
  return {
    id: 'spell-1',
    name: 'Armadura de Mago',
    system: { uses: { spent: 0, max: 1 } },
    getFlag: vi.fn(() => undefined),
    update: vi.fn(async () => ({})),
    ...overrides,
  };
}

function makeActor(items, overrides = {}) {
  return {
    name: 'Karon',
    items,
    system: { spells: { spell1: { value: 2, max: 4 }, spell3: { value: 0, max: 3 } } },
    update: vi.fn(async () => ({})),
    ...overrides,
  };
}

describe('applyItemCast', () => {
  beforeEach(() => {
    global.game = { user: { id: 'gm-1' }, users: { activeGM: { id: 'gm-1' } } };
    global.ChatMessage = {
      getSpeaker: vi.fn(() => ({ alias: 'Karon' })),
      create: vi.fn(async () => ({})),
    };
  });

  it('using=slot: desconta 1 do slot do círculo escolhido no Ator', async () => {
    const item = makeItem();
    const actor = makeActor([item]);

    await applyItemCast(actor, { itemId: 'spell-1', using: 'slot', slotLevel: 1 });

    expect(actor.update).toHaveBeenCalledWith({ 'system.spells.spell1.value': 1 });
  });

  it('using=slot: não desconta (nem erra) se não há slot restante nesse círculo', async () => {
    const item = makeItem();
    const actor = makeActor([item]);

    await applyItemCast(actor, { itemId: 'spell-1', using: 'slot', slotLevel: 3 });

    expect(actor.update).not.toHaveBeenCalled();
  });

  it('using=slot: ignora slotLevel fora de 1-9', async () => {
    const item = makeItem();
    const actor = makeActor([item]);

    await applyItemCast(actor, { itemId: 'spell-1', using: 'slot', slotLevel: 10 });
    await applyItemCast(actor, { itemId: 'spell-1', using: 'slot', slotLevel: 0 });

    expect(actor.update).not.toHaveBeenCalled();
  });

  it('using=itemUses: gasta a carga própria do item (conjuração gratuita)', async () => {
    const item = makeItem({ system: { uses: { spent: 0, max: 1 } } });
    const actor = makeActor([item]);

    await applyItemCast(actor, { itemId: 'spell-1', using: 'itemUses' });

    expect(item.update).toHaveBeenCalledWith({ 'system.uses.spent': 1 });
  });

  it('using=itemUses: não desconta se já não tem carga (spent >= max)', async () => {
    const item = makeItem({ system: { uses: { spent: 1, max: 1 } } });
    const actor = makeActor([item]);

    await applyItemCast(actor, { itemId: 'spell-1', using: 'itemUses' });

    expect(item.update).not.toHaveBeenCalled();
  });

  it('using=gm: posta aviso no chat, não desconta nada do Ator nem do item', async () => {
    const item = makeItem({ name: 'Bola de Fogo de Explosão Retardada' });
    const actor = makeActor([item]);

    await applyItemCast(actor, { itemId: 'spell-1', using: 'gm' });

    expect(ChatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Bola de Fogo de Explosão Retardada'),
      }),
    );
    expect(actor.update).not.toHaveBeenCalled();
    expect(item.update).not.toHaveBeenCalled();
  });

  it('resolve o item pelo flag sourceId quando o id do draft difere do _id real', async () => {
    const item = makeItem({
      id: 'foundry-real-id',
      getFlag: vi.fn((scope, key) => (scope === 'arthinfo-fichas-sync' && key === 'sourceId' ? 'draft-side-id' : undefined)),
    });
    const actor = makeActor([item]);

    await applyItemCast(actor, { itemId: 'draft-side-id', using: 'itemUses' });

    expect(item.update).toHaveBeenCalledWith({ 'system.uses.spent': 1 });
  });

  it('não faz nada se o item não existe no Ator', async () => {
    const item = makeItem({ id: 'other' });
    const actor = makeActor([item]);

    await applyItemCast(actor, { itemId: 'missing', using: 'itemUses' });

    expect(item.update).not.toHaveBeenCalled();
  });

  it('não aplica nada se este cliente não é o GM ativo (evita conjurar em dobro com 2 GMs conectados)', async () => {
    game.users.activeGM = { id: 'gm-2' };
    const item = makeItem();
    const actor = makeActor([item]);

    await applyItemCast(actor, { itemId: 'spell-1', using: 'slot', slotLevel: 1 });

    expect(actor.update).not.toHaveBeenCalled();
  });

  it('ignora payload malformado', async () => {
    const item = makeItem();
    const actor = makeActor([item]);

    await applyItemCast(actor, {});
    await applyItemCast(actor, { itemId: 'spell-1' });
    await applyItemCast(null, { itemId: 'spell-1', using: 'itemUses' });

    expect(actor.update).not.toHaveBeenCalled();
    expect(item.update).not.toHaveBeenCalled();
  });
});
